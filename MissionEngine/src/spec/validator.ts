// Copyright 2026 Dennis L. Brandl
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import type { ValidationResult, ValidationWarning } from './types.js';
import { GATE_MAX_DELAY_SECONDS } from './types.js';
import { partitionCatchNetworks, type PartitionStep, type PartitionConnection } from './catch-network.js';
import { hasValidServerUriScheme } from '../lib/server-uri.js';
// Final-review Critical 1 fix: a STATIC import, not a runtime readFileSync probe against
// __dirname-relative candidate paths. The old probe's last candidate resolved to the
// TrajectoryRuntime SUBMODULE copy (the only copy that ever existed in the repo) — fine under
// `tsx` in dev (where the sibling submodule checkout is actually on disk), but the production
// Docker image copies ONLY the bundled engine.mjs (Dockerfile) and .dockerignore excludes
// TrajectoryRuntime from the build context entirely, so every candidate missed and the throw
// wedged every queued instance forever (see loadSchema below). A static import lets esbuild
// inline the schema's JSON content directly into engine.mjs at bundle time — the image is
// self-contained by construction, no COPY step or runtime path probing required. tsx and
// vitest (Vite) both resolve `with { type: 'json' }` JSON imports natively in dev, so the same
// source line works unmodified in every context this file ever runs in.
import workflowSchemaRaw from './workflow-schema.json' with { type: 'json' };

function normalizeStepType(t: string): string {
  return t.replace(/_/g, ' ');
}

// Pre-checks: catch missing required fields on steps/connections before
// semantic graph analysis (which would misinterpret them)
function preStructuralChecks(workflow: Record<string, unknown>): ValidationResult | null {
  const steps = workflow['steps'];
  const connections = workflow['connections'];

  if (!Array.isArray(steps)) {
    return { valid: false, error_code: 'MISSING_REQUIRED_FIELD', error_message: 'Missing steps array' };
  }
  if (!Array.isArray(connections)) {
    return { valid: false, error_code: 'MISSING_REQUIRED_FIELD', error_message: 'Missing connections array' };
  }

  // Check each step has required ManagedElement fields
  for (const step of steps) {
    if (!step || typeof step !== 'object') {
      return { valid: false, error_code: 'MISSING_REQUIRED_FIELD', error_message: 'Invalid step entry' };
    }
    for (const field of ['local_id', 'oid', 'version', 'last_modified_date']) {
      if (!(field in step)) {
        return { valid: false, error_code: 'MISSING_REQUIRED_FIELD', error_message: `Step missing required field: ${field}` };
      }
    }
    if (!('step_type' in step)) {
      return { valid: false, error_code: 'MISSING_REQUIRED_FIELD', error_message: 'Step missing required field: step_type' };
    }
  }

  // Check each connection has required fields
  for (const conn of connections) {
    if (!conn || typeof conn !== 'object') {
      return { valid: false, error_code: 'MISSING_REQUIRED_FIELD', error_message: 'Invalid connection entry' };
    }
    if (!('from_step_id' in conn)) {
      return { valid: false, error_code: 'MISSING_REQUIRED_FIELD', error_message: 'Connection missing from_step_id' };
    }
    if (!('to_step_id' in conn)) {
      return { valid: false, error_code: 'MISSING_REQUIRED_FIELD', error_message: 'Connection missing to_step_id' };
    }
  }

  return null;
}

// Semantic checks: graph-level analysis
function semanticValidation(workflow: Record<string, unknown>): ValidationResult | null {
  const steps = workflow['steps'] as Record<string, unknown>[];
  const connections = workflow['connections'] as Record<string, unknown>[];

  // Duplicate step OIDs
  const oids = new Set<string>();
  for (const step of steps) {
    const oid = step.oid as string;
    if (oids.has(oid)) {
      return { valid: false, error_code: 'DUPLICATE_STEP_OID', error_message: `Duplicate step OID: ${oid}` };
    }
    oids.add(oid);
  }

  // Count START and END steps
  let startCount = 0;
  let endCount = 0;
  for (const step of steps) {
    const st = normalizeStepType(String(step.step_type));
    if (st === 'START') startCount++;
    if (st === 'END') endCount++;
  }

  if (startCount === 0) {
    return { valid: false, error_code: 'NO_START_STEP', error_message: 'No START step found' };
  }
  if (startCount > 1) {
    return { valid: false, error_code: 'MULTIPLE_START_STEPS', error_message: 'Multiple START steps found' };
  }
  if (endCount === 0) {
    return { valid: false, error_code: 'NO_END_STEP', error_message: 'No END step found' };
  }

  // Dangling connections (reference non-existent step)
  for (const conn of connections) {
    const from = conn.from_step_id as string;
    const to = conn.to_step_id as string;
    if (!oids.has(from)) {
      return { valid: false, error_code: 'DANGLING_CONNECTION', error_message: `Connection references non-existent step: ${from}` };
    }
    if (!oids.has(to)) {
      return { valid: false, error_code: 'DANGLING_CONNECTION', error_message: `Connection references non-existent step: ${to}` };
    }
  }

  // Self-referencing connections
  for (const conn of connections) {
    if (conn.from_step_id === conn.to_step_id) {
      return { valid: false, error_code: 'SELF_REFERENCING_CONNECTION', error_message: `Self-referencing connection on step: ${conn.from_step_id}` };
    }
  }

  // Orphaned steps (not reachable from START via BFS)
  const startOid = steps.find(s => normalizeStepType(String(s.step_type)) === 'START')!.oid as string;
  const reachable = new Set<string>();
  const queue = [startOid];
  reachable.add(startOid);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const conn of connections) {
      if (conn.from_step_id === current && !reachable.has(conn.to_step_id as string)) {
        reachable.add(conn.to_step_id as string);
        queue.push(conn.to_step_id as string);
      }
    }
  }
  // Catch networks are intentional disconnected islands (reached at runtime via TRY, not via a connection).
  const partition = partitionCatchNetworks(
    steps as unknown as PartitionStep[],
    connections as unknown as PartitionConnection[],
  );
  for (const step of steps) {
    const oid = step.oid as string;
    if (partition.catchNetworkStepOids.has(oid)) continue;
    if (!reachable.has(oid)) {
      return { valid: false, error_code: 'ORPHANED_STEP', error_message: `Step ${oid} is not reachable from START` };
    }
  }

  // PARALLEL without matching WAIT ALL
  for (const step of steps) {
    const st = normalizeStepType(String(step.step_type));
    if (st === 'PARALLEL') {
      if (!hasMatchingWaitAll(step.oid as string, steps, connections)) {
        return { valid: false, error_code: 'UNMATCHED_PARALLEL', error_message: `PARALLEL step ${step.oid} has no matching WAIT ALL` };
      }
    }
  }

  return null;
}

function hasMatchingWaitAll(parallelOid: string, steps: Record<string, unknown>[], connections: Record<string, unknown>[]): boolean {
  const stepMap = new Map<string, string>();
  for (const s of steps) {
    stepMap.set(s.oid as string, normalizeStepType(String(s.step_type)));
  }

  const visited = new Set<string>();
  const queue: string[] = [];
  for (const conn of connections) {
    if (conn.from_step_id === parallelOid) {
      queue.push(conn.to_step_id as string);
    }
  }

  while (queue.length > 0) {
    const oid = queue.shift()!;
    if (visited.has(oid)) continue;
    visited.add(oid);
    const type = stepMap.get(oid);
    if (type === 'WAIT ALL') return true;
    if (type === 'END') continue;
    for (const conn of connections) {
      if (conn.from_step_id === oid) {
        queue.push(conn.to_step_id as string);
      }
    }
  }
  return false;
}

function tryCatchValidation(workflow: Record<string, unknown>): ValidationResult | null {
  const steps = (workflow['steps'] as Record<string, unknown>[]) ?? [];
  const connections = (workflow['connections'] as Record<string, unknown>[]) ?? [];
  const fail = (code: string, msg: string, oid?: string): ValidationResult =>
    ({ valid: false, error_code: code, error_message: oid ? `${msg} (step ${oid})` : msg });

  // Spec 2026-08-22 D5: the full TRY-capable set, aligned with Designer and extended with
  // WORKFLOW PROXY (D3 bubbling routes escalated child failures through the proxy's own
  // rows). The former 'WAIT ACTION PROXY' entry was dead — not in the StepType enum.
  // Spec 2026-08-29 §5.6/§6.6: GATE joins the set — a throwing/timing-out gate script or a
  // failed Action Property fetch fails the step (mode ERROR), same posture as SCRIPT.
  const TRY_SCOPED = new Set(['ACTION PROXY', 'SCRIPT', 'USER INTERACTION', 'YES NO', 'WORKFLOW PROXY', 'GATE']);
  const MODES = new Set(['ERROR', 'ABORT', 'TIMEOUT']);
  const COMMANDS = new Set(['ABANDON', 'RESTART', 'GOTO', 'RETRY', 'COMPLETE']);

  for (const step of steps) {
    const type = normalizeStepType(String(step.step_type));
    const oid = step.oid as string;
    const inDeg = connections.filter(c => c.to_step_id === oid).length;
    const outDeg = connections.filter(c => c.from_step_id === oid).length;

    if (type === 'CATCH' && (inDeg !== 0 || outDeg !== 1)) {
      return fail('CATCH_WRONG_DEGREE', `CATCH must have 0 incoming and 1 outgoing connection (has ${inDeg} in, ${outDeg} out)`, oid);
    }
    if (type === 'RETURN' && (inDeg !== 1 || outDeg !== 0)) {
      return fail('RETURN_WRONG_DEGREE', `RETURN must have 1 incoming and 0 outgoing connections (has ${inDeg} in, ${outDeg} out)`, oid);
    }

    const tries = step.try_specifications as Array<{ mode: string; catch_id: string }> | undefined;
    if (tries && tries.length > 0) {
      if (!TRY_SCOPED.has(type)) {
        return fail('TRY_ON_INVALID_STEP', `try_specifications not allowed on step_type '${type}'`, oid);
      }
      const seen = new Set<string>();
      for (const t of tries) {
        if (!MODES.has(t.mode)) return fail('INVALID_TRY_MODE', `invalid try mode '${t.mode}'`, oid);
        if (seen.has(t.mode)) return fail('DUPLICATE_TRY_MODE', `mode '${t.mode}' appears more than once`, oid);
        seen.add(t.mode);
      }
    }

    if (type === 'RETURN') {
      const rc = step.return_config as { command?: string; restart_mode?: string; goto_step_oid?: string } | undefined;
      // A RETURN must carry a valid command. A missing return_config (e.g. a RETURN left
      // at the editor's visual default) is rejected here rather than silently stranding the
      // workflow at runtime (dispatchReturn would otherwise no-op on the absent config).
      if (!rc || !rc.command || !COMMANDS.has(rc.command)) {
        return fail('INVALID_RETURN_COMMAND', `RETURN requires a valid return_config.command (got '${rc?.command ?? 'none'}')`, oid);
      }
      if (rc.command === 'RESTART' && !rc.restart_mode) return fail('MISSING_RESTART_MODE', `RESTART requires restart_mode`, oid);
      if (rc.restart_mode && rc.restart_mode !== 'CLEAN' && rc.restart_mode !== 'KEEP') return fail('INVALID_RESTART_MODE', `invalid restart_mode '${rc.restart_mode}'`, oid);
      if (rc.command === 'GOTO' && !rc.goto_step_oid) return fail('MISSING_GOTO_TARGET', `GOTO requires goto_step_oid`, oid);
    }
  }

  // Spec 2026-08-22 §5: workflow-level rows get the same mode rules as a step's.
  const wfTries = workflow['try_specifications'] as Array<{ mode: string; catch_id: string }> | undefined;
  if (wfTries && wfTries.length > 0) {
    const seenWf = new Set<string>();
    for (const t of wfTries) {
      if (!MODES.has(t.mode)) return fail('INVALID_TRY_MODE', `invalid workflow-level try mode '${t.mode}'`);
      if (seenWf.has(t.mode)) return fail('DUPLICATE_TRY_MODE', `workflow-level mode '${t.mode}' appears more than once`);
      seenWf.add(t.mode);
    }
  }

  // Cross-reference: catch_id uniqueness, TRY→CATCH resolution, GOTO target.
  const catchIds = new Set<string>();
  for (const step of steps) {
    if (normalizeStepType(String(step.step_type)) !== 'CATCH') continue;
    const cid = step.catch_id as string | undefined;
    if (!cid) continue;
    if (catchIds.has(cid)) return fail('DUPLICATE_CATCH_ID', `catch_id '${cid}' used by more than one CATCH`, step.oid as string);
    catchIds.add(cid);
  }
  const oidSet = new Set(steps.map(s => s.oid as string));
  const partition = partitionCatchNetworks(steps as unknown as PartitionStep[], connections as unknown as PartitionConnection[]);
  for (const step of steps) {
    const tries = step.try_specifications as Array<{ catch_id: string }> | undefined;
    for (const t of tries ?? []) {
      if (!catchIds.has(t.catch_id)) return fail('UNMATCHED_TRY', `TRY references undefined catch_id '${t.catch_id}'`, step.oid as string);
    }
    if (normalizeStepType(String(step.step_type)) === 'RETURN') {
      const rc = step.return_config as { command?: string; goto_step_oid?: string } | undefined;
      if (rc?.command === 'GOTO' && rc.goto_step_oid) {
        if (!oidSet.has(rc.goto_step_oid)) return fail('GOTO_TARGET_NOT_FOUND', `GOTO target '${rc.goto_step_oid}' not found`, step.oid as string);
        if (partition.catchNetworkStepOids.has(rc.goto_step_oid)) return fail('GOTO_TARGET_IN_CATCH', `GOTO target '${rc.goto_step_oid}' is inside a catch network`, step.oid as string);
      }
    }
  }

  for (const t of wfTries ?? []) {
    if (!catchIds.has(t.catch_id)) return fail('UNMATCHED_TRY', `workflow-level TRY references undefined catch_id '${t.catch_id}'`);
  }

  // Topology: no edge may cross the main-flow / catch-network boundary (spec §6.3).
  // The partition is RETURN-gated (spec §6.5); structural-degree checks above fire first.
  // CATCH_WITHOUT_RETURN / RETURN_WITHOUT_CATCH / CATCH_NETWORK_NOT_CONNECTED (spec §6.3)
  // are editor-time codes (§6.6); at runtime a RETURN-less or internally-disconnected
  // catch island is rejected transitively by the ORPHANED_STEP check in semanticValidation.
  for (const c of connections) {
    const fromIn = partition.catchNetworkStepOids.has(c.from_step_id as string);
    const toIn = partition.catchNetworkStepOids.has(c.to_step_id as string);
    if (fromIn !== toIn) {
      return fail('CROSS_NETWORK_EDGE', `connection ${c.from_step_id} → ${c.to_step_id} crosses the catch-network boundary`);
    }
  }
  // ORPHANED_CATCH (a catch_id referenced by no TRY) is ACCEPTED at runtime (valid:true);
  // the editor surfaces the warning chip (spec §6.3, §6.6).

  return null;
}

/** GATE structural rules (spec 2026-08-29 §6.6): exactly 1-in/1-out; cycle_seconds >= 1
 *  when present. Binding-resolution problems are deliberately NOT errors here — a binding
 *  naming an unknown environment fails that gate's evaluation at runtime (TRY-routable). */
function gateValidation(workflow: Record<string, unknown>): ValidationResult | null {
  const steps = (workflow['steps'] as Record<string, unknown>[]) ?? [];
  const connections = (workflow['connections'] as Record<string, unknown>[]) ?? [];
  const fail = (code: string, msg: string, oid?: string): ValidationResult =>
    ({ valid: false, error_code: code, error_message: oid ? `${msg} (step ${oid})` : msg });
  for (const step of steps) {
    if (normalizeStepType(String(step.step_type)) !== 'GATE') continue;
    const oid = step.oid as string;
    const inDeg = connections.filter(c => c.to_step_id === oid).length;
    const outDeg = connections.filter(c => c.from_step_id === oid).length;
    if (inDeg !== 1 || outDeg !== 1) {
      return fail('GATE_WRONG_DEGREE', `GATE must have exactly 1 incoming and 1 outgoing connection (has ${inDeg} in, ${outDeg} out)`, oid);
    }
    const gc = step.gate_config as { cycle_seconds?: unknown } | undefined;
    if (gc?.cycle_seconds !== undefined && (typeof gc.cycle_seconds !== 'number' || !(gc.cycle_seconds >= 1 && gc.cycle_seconds <= GATE_MAX_DELAY_SECONDS))) {
      return fail('INVALID_GATE_CYCLE', `gate_config.cycle_seconds must be a number from 1 to ${GATE_MAX_DELAY_SECONDS} (got '${String(gc.cycle_seconds)}')`, oid);
    }
    // Spec 2026-10-13 §3.2: timed gates.
    const tc = step.gate_config as { mode?: unknown; delay_seconds?: unknown } | undefined;
    const mode = tc?.mode;
    if (mode !== undefined && mode !== 'condition' && mode !== 'timer' && mode !== 'condition_or_timer') {
      return fail('INVALID_GATE_MODE', `gate_config.mode must be 'condition', 'timer' or 'condition_or_timer' (got '${String(mode)}')`, oid);
    }
    const timed = mode === 'timer' || mode === 'condition_or_timer';
    const delay = tc?.delay_seconds;
    if (timed && delay === undefined) {
      return fail('GATE_DELAY_REQUIRED', `gate_config.delay_seconds is required when mode is '${String(mode)}'`, oid);
    }
    if (!timed && delay !== undefined) {
      return fail('GATE_DELAY_WITHOUT_TIMER', `gate_config.delay_seconds is only valid with mode 'timer' or 'condition_or_timer'`, oid);
    }
    if (delay !== undefined && (typeof delay !== 'number' || !Number.isInteger(delay) || delay < 1 || delay > GATE_MAX_DELAY_SECONDS)) {
      return fail('INVALID_GATE_DELAY', `gate_config.delay_seconds must be a whole number of seconds from 1 to ${GATE_MAX_DELAY_SECONDS} (got '${String(delay)}')`, oid);
    }
    // Escalated review finding (controller ruling): a GATE that ALSO declares resource commands
    // never actually acquires them — activateGateStep (transition.ts) has no tryActivateResources
    // call at all, unlike every other step type, regardless of whether the gate is armed (spec
    // 2026-08-29, amended 2026-08-30: `gate_config.control_previous_action` only changes WHEN a
    // gate materializes — concurrently with its predecessor when opted in, or through the
    // ordinary READY->activate flow otherwise — never whether it acquires resources) — while
    // drainCascade's own dequeue-time release still fires unconditionally for any step whose
    // resource_command_specifications is non-empty. An acquire that never actually ran would
    // still release a pool slot out from under whoever legitimately holds it. Designer exports
    // resource_command_specifications for every node type, so this must be a hard validation
    // error, not merely undocumented.
    const rcs = step['resource_command_specifications'] as unknown[] | undefined;
    if (Array.isArray(rcs) && rcs.length > 0) {
      return fail('GATE_RESOURCES_UNSUPPORTED', 'GATE steps cannot declare resource commands', oid);
    }
  }
  return null;
}

/** Repeating SCRIPT rules (spec 2026-10-13 §6.1). Semantic (this file's precedence): these
 *  run before the JSON schema, so the author gets a named code rather than a schema message. */
function scriptValidation(workflow: Record<string, unknown>): ValidationResult | null {
  const steps = (workflow['steps'] as Record<string, unknown>[]) ?? [];
  const fail = (code: string, msg: string, oid: string): ValidationResult =>
    ({ valid: false, error_code: code, error_message: `${msg} (step ${oid})` });
  for (const step of steps) {
    if (normalizeStepType(String(step.step_type)) !== 'SCRIPT') continue;
    const oid = step.oid as string;
    const repeat = (step.script_config as { repeat?: unknown } | undefined)?.repeat;
    if (repeat === undefined) continue;
    if (repeat === null || typeof repeat !== 'object' || Array.isArray(repeat)) {
      return fail('INVALID_SCRIPT_REPEAT', 'script_config.repeat must be an object', oid);
    }
    const { cycle_seconds: cycle, time_limit_seconds: limit, on_time_limit: onLimit } = repeat as Record<string, unknown>;
    if (cycle !== undefined && (typeof cycle !== 'number' || !(cycle >= 1 && cycle <= GATE_MAX_DELAY_SECONDS))) {
      return fail('INVALID_SCRIPT_CYCLE', `script_config.repeat.cycle_seconds must be a number from 1 to ${GATE_MAX_DELAY_SECONDS} (got '${String(cycle)}')`, oid);
    }
    if (limit !== undefined && (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > GATE_MAX_DELAY_SECONDS)) {
      return fail('INVALID_SCRIPT_TIME_LIMIT', `script_config.repeat.time_limit_seconds must be a whole number of seconds from 1 to ${GATE_MAX_DELAY_SECONDS} (got '${String(limit)}')`, oid);
    }
    if (onLimit !== undefined && onLimit !== 'error' && onLimit !== 'complete') {
      return fail('INVALID_SCRIPT_TIME_LIMIT_ACTION', `script_config.repeat.on_time_limit must be 'error' or 'complete' (got '${String(onLimit)}')`, oid);
    }
    if (onLimit !== undefined && limit === undefined) {
      return fail('SCRIPT_TIME_LIMIT_ACTION_WITHOUT_LIMIT', 'script_config.repeat.on_time_limit is only valid with time_limit_seconds', oid);
    }
  }
  return null;
}

/** Binding-resolution advisories for BOTH binding homes (GATE spec 2026-08-29 §6.6; spec
 *  2026-09-04 §5.4.7): a binding naming an unknown environment, or a parameter_id matching no
 *  input parameter, doesn't fail validation — it fails that step's own acquisition/evaluation at
 *  runtime, which is TRY-routable — but the author should hear about it up front. GATE reads
 *  `gate_config.action_property_bindings`; every other step reads step-level
 *  `action_property_bindings`; a GATE carrying step-level entries is told they are ignored.
 *  Environment resolution mirrors actionProxyValidation's oid-or-name discipline. */
function bindingWarnings(workflow: Record<string, unknown>): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const steps = (workflow['steps'] as Record<string, unknown>[]) ?? [];
  const envSpecs = (workflow['environment_specifications'] as Record<string, unknown>[] | undefined) ?? [];
  const knownEnvOids = new Set(envSpecs.map(e => e['oid']).filter((v): v is string => typeof v === 'string'));
  const knownEnvNames = new Set(envSpecs.map(e => e['local_id']).filter((v): v is string => typeof v === 'string'));

  for (const step of steps) {
    const isGate = normalizeStepType(String(step.step_type)) === 'GATE';
    const stepLabel = (step['local_id'] as string | undefined) ?? (step['oid'] as string | undefined) ?? '<unknown>';
    const stepLevel = (step['action_property_bindings'] as Record<string, unknown>[] | undefined) ?? [];
    if (isGate && stepLevel.length > 0) {
      warnings.push({
        code: 'INPUT_BINDING_ON_GATE_IGNORED',
        message:
          `Step "${stepLabel}" is a GATE but carries step-level action_property_bindings — a GATE reads only ` +
          `gate_config.action_property_bindings; the step-level entries are ignored.`,
      });
    }
    const gc = step['gate_config'] as Record<string, unknown> | undefined;
    const bindings = isGate
      ? ((gc?.['action_property_bindings'] as Record<string, unknown>[] | undefined) ?? [])
      : stepLevel;
    if (bindings.length === 0) continue;
    const prefix = isGate ? 'GATE_BINDING' : 'INPUT_BINDING';
    const kind = isGate ? 'GATE binding' : 'input binding';
    const consequence = isGate
      ? `this gate's evaluation will fail at runtime unless a TRY handles it.`
      : `this step's input acquisition will fail at runtime unless a TRY handles it.`;
    const inputIds = new Set(
      ((step['input_parameter_specifications'] as Record<string, unknown>[] | undefined) ?? [])
        .map(p => p['id'])
        .filter((v): v is string => typeof v === 'string'),
    );

    for (const b of bindings) {
      const parameterId = b['parameter_id'] as string | undefined;
      const envOid = b['environment_oid'] as string | undefined;
      const envName = b['environment_name'] as string | undefined;
      if (envOid || envName) {
        const resolved = (!!envOid && knownEnvOids.has(envOid)) || (!!envName && knownEnvNames.has(envName));
        if (!resolved) {
          warnings.push({
            code: `${prefix}_UNKNOWN_ENVIRONMENT`,
            message:
              `Step "${stepLabel}" ${kind} for parameter "${parameterId ?? '<unknown>'}" references an environment ` +
              `that resolves by neither oid ('${envOid ?? ''}') nor name ('${envName ?? ''}') against this spec's ` +
              `environment_specifications — ${consequence}`,
          });
        }
      }
      if (parameterId && !inputIds.has(parameterId)) {
        warnings.push({
          code: `${prefix}_UNKNOWN_PARAMETER`,
          message:
            `Step "${stepLabel}" ${kind} parameter_id "${parameterId}" matches no ` +
            `input_parameter_specifications id on this step — ${consequence}`,
        });
      }
    }
  }
  return warnings;
}

function actionProxyValidation(workflow: Record<string, unknown>): ValidationResult | null {
  const steps = workflow['steps'] as Array<Record<string, unknown>>;
  const envSpecs = (workflow['environment_specifications'] as Array<Record<string, unknown>> | undefined) ?? [];

  const envActions = new Map<string, Set<string>>();
  for (const env of envSpecs) {
    const envOid = env['oid'] as string | undefined;
    if (typeof envOid !== 'string') continue;
    const included = (env['included_actions'] as Array<Record<string, unknown>> | undefined) ?? [];
    const oids = new Set<string>();
    for (const a of included) {
      // Real CM-ingested packages spell the roster oid `oid`; the engine's fixtures (and the
      // schema's IncludedAction) use `action_oid`. Accept both — observed live 2026-08-20.
      const aOid = a['action_oid'] ?? a['oid'];
      if (typeof aOid === 'string') oids.add(aOid);
    }
    envActions.set(envOid, oids);
  }

  for (const step of steps) {
    if (step['step_type'] !== 'ACTION PROXY') continue;
    const stepOid = (step['oid'] as string | undefined) ?? '<unknown>';
    const config = step['action_proxy_config'] as Record<string, unknown> | undefined;
    if (!config) {
      return { valid: false, error_code: 'INVALID_VALIDATION', error_message: `ACTION PROXY step ${stepOid} missing action_proxy_config` };
    }
    const envOid = config['environment_oid'] as string | undefined;
    const actionOid = config['action_oid'] as string | undefined;
    if (!envOid || !actionOid) {
      return { valid: false, error_code: 'INVALID_VALIDATION', error_message: `ACTION PROXY step ${stepOid} action_proxy_config missing required field` };
    }
    // Spec 2026-08-21 (action-proxy name binding): a config carrying the bound NAME is
    // acceptable even when its oid dangles — dispatch resolves package-internally by name
    // (P1/P2) and, under loose, against the container (F1-F5). Presence-based on purpose:
    // the matching mode is read per dispatch and can flip between activation and dispatch,
    // so validation must not branch on it. Both rejection messages below are byte-identical
    // to the pre-2026-08-21 ones.
    const envName = config['environment_name'];
    const hasEnvName = typeof envName === 'string' && envName.length > 0;
    const cfgActionName = config['action_name'];
    const hasActionName = typeof cfgActionName === 'string' && cfgActionName.length > 0;
    const envKnown = envActions.has(envOid);
    if (!envKnown && !hasEnvName) {
      return { valid: false, error_code: 'INVALID_VALIDATION', error_message: `ACTION PROXY step ${stepOid} references unknown environment_oid ${envOid}` };
    }
    const actionInRoster = envKnown && envActions.get(envOid)!.has(actionOid);
    if (!actionInRoster && !hasActionName) {
      return { valid: false, error_code: 'INVALID_VALIDATION', error_message: `ACTION PROXY step ${stepOid} action_oid ${actionOid} not in environment ${envOid}` };
    }
  }
  return null;
}

function resourceValidation(workflow: Record<string, unknown>): ValidationResult | null {
  // Build (sourceOid → Map<resourceName, resource_type>) across the whole tree:
  // every workflow's own (workflow-scoped) resources keyed by that workflow's oid,
  // every embedded environment's resources keyed by that environment's oid.
  // An empty inner Map records that the source oid IS known even if it owns no resources,
  // letting us distinguish "unknown source" from "known source missing this resource".
  const ownedResources = new Map<string, Map<string, string>>();

  function recordOwner(sourceOid: string | undefined, name: string | undefined, type: string | undefined): void {
    if (typeof sourceOid !== 'string') return;
    let owned = ownedResources.get(sourceOid);
    if (!owned) {
      owned = new Map<string, string>();
      ownedResources.set(sourceOid, owned);
    }
    if (typeof name === 'string' && typeof type === 'string' && !owned.has(name)) {
      owned.set(name, type);
    }
  }

  function gatherOwners(spec: Record<string, unknown> | undefined): void {
    if (!spec || typeof spec !== 'object') return;
    const specOid = spec['oid'] as string | undefined;
    if (typeof specOid === 'string') recordOwner(specOid, undefined, undefined);

    const wfResources = spec['resource_property_specifications'] as Record<string, unknown>[] | undefined;
    if (Array.isArray(wfResources)) {
      for (const r of wfResources) {
        if (r['scope'] === 'environment') continue;
        recordOwner(specOid, r['name'] as string, r['resource_type'] as string);
      }
    }

    const envSpecs = spec['environment_specifications'] as Record<string, unknown>[] | undefined;
    if (Array.isArray(envSpecs)) {
      for (const env of envSpecs) {
        const envOid = env['oid'] as string | undefined;
        if (typeof envOid === 'string') recordOwner(envOid, undefined, undefined);
        const envResources = env['resource_property_specifications'] as Record<string, unknown>[] | undefined;
        if (Array.isArray(envResources)) {
          for (const r of envResources) {
            recordOwner(envOid, r['name'] as string, r['resource_type'] as string);
          }
        }
      }
    }

    const childSpecs = spec['children'] as Record<string, unknown>[] | undefined;
    if (Array.isArray(childSpecs)) {
      for (const c of childSpecs) gatherOwners(c);
    }
  }

  gatherOwners(workflow);

  const ACQUIRE_RELEASE_TYPES = new Set(['binary exclusive use', 'binary shared use with pool limits', 'named pool']);
  const COUNTABLE_TYPES = new Set(['countable use with pool limits']);
  const SYNC_TYPES = new Set(['sync']);
  const SYNC_COMMANDS = new Set(['Send', 'Receive', 'Synchronize']);

  function validateSpecSteps(spec: Record<string, unknown>): ValidationResult | null {
    const specOid = spec['oid'] as string | undefined;
    const steps = spec['steps'] as Record<string, unknown>[] | undefined;
    if (Array.isArray(steps)) {
      for (const step of steps) {
        const cmds = step['resource_command_specifications'] as Record<string, unknown>[] | undefined;
        if (!Array.isArray(cmds) || cmds.length === 0) continue;
        let syncCount = 0;
        const stepLabel = (step['local_id'] as string | undefined) ?? (step['oid'] as string | undefined) ?? '<unknown>';

        for (const cmd of cmds) {
          const commandType = cmd['command_type'] as string;
          const resourceName = cmd['resource_name'] as string;
          const sourceOid = (cmd['resource_source_oid'] as string | undefined) ?? specOid;

          const ownedByThisSource = typeof sourceOid === 'string' ? ownedResources.get(sourceOid) : undefined;
          const resType = ownedByThisSource?.get(resourceName);

          if (!resType) {
            // Distinguish: source oid unknown vs known source missing this resource name.
            if (!ownedByThisSource) {
              return {
                valid: false,
                error_code: 'INVALID_RESOURCE_COMMAND',
                error_message: `Step "${stepLabel}" command "${commandType}": resource_source_oid "${sourceOid ?? '(none)'}" does not match any workflow or environment in this package`,
              };
            }
            return {
              valid: false,
              error_code: 'INVALID_RESOURCE_COMMAND',
              error_message: `Resource command references unknown resource: "${resourceName}"`,
            };
          }

          if (commandType === 'Acquire' || commandType === 'Release') {
            if (!ACQUIRE_RELEASE_TYPES.has(resType)) {
              return { valid: false, error_code: 'INVALID_RESOURCE_COMMAND', error_message: `${commandType} not compatible with resource type "${resType}"` };
            }
          } else if (commandType === 'Acquire Pool Amount' || commandType === 'Release Pool Amount') {
            if (!COUNTABLE_TYPES.has(resType)) {
              return { valid: false, error_code: 'INVALID_RESOURCE_COMMAND', error_message: `${commandType} not compatible with resource type "${resType}"` };
            }
            const amount = cmd['amount'] as number | undefined;
            if (!amount || amount <= 0) {
              return { valid: false, error_code: 'INVALID_RESOURCE_COMMAND', error_message: `${commandType} requires amount > 0` };
            }
          } else if (SYNC_COMMANDS.has(commandType)) {
            if (!SYNC_TYPES.has(resType)) {
              return { valid: false, error_code: 'INVALID_RESOURCE_COMMAND', error_message: `${commandType} not compatible with resource type "${resType}"` };
            }
            syncCount++;
          }
        }

        if (syncCount > 1) {
          return { valid: false, error_code: 'INVALID_RESOURCE_COMMAND', error_message: `Step "${step['oid']}" has ${syncCount} sync commands (max 1)` };
        }
      }
    }

    const childSpecs = spec['children'] as Record<string, unknown>[] | undefined;
    if (Array.isArray(childSpecs)) {
      for (const c of childSpecs) {
        const err = validateSpecSteps(c);
        if (err) return err;
      }
    }
    return null;
  }

  const stepError = validateSpecSteps(workflow);
  if (stepError) return stepError;

  function validateSpecResourceShape(spec: Record<string, unknown>): ValidationResult | null {
    const resourceSpecs = spec['resource_property_specifications'] as Record<string, unknown>[] | undefined;
    if (Array.isArray(resourceSpecs)) {
      for (const rspec of resourceSpecs) {
        if (rspec['resource_type'] === 'named pool') {
          const names = rspec['names'] as string[] | undefined;
          if (!names || names.length === 0) {
            return { valid: false, error_code: 'INVALID_RESOURCE_SPEC', error_message: `Named pool "${rspec['name']}" must have a non-empty names array` };
          }
        }
        if (rspec['resource_type'] === 'binary shared use with pool limits' || rspec['resource_type'] === 'countable use with pool limits') {
          const limit = rspec['use_limit'] as number | undefined;
          if (!limit || limit <= 0) {
            return { valid: false, error_code: 'INVALID_RESOURCE_SPEC', error_message: `Resource "${rspec['name']}" requires use_limit > 0` };
          }
        }
      }
    }
    const childSpecs = spec['children'] as Record<string, unknown>[] | undefined;
    if (Array.isArray(childSpecs)) {
      for (const c of childSpecs) {
        const err = validateSpecResourceShape(c);
        if (err) return err;
      }
    }
    return null;
  }

  return validateSpecResourceShape(workflow);
}

// ────────────────────────────────────────────────────────────────────────────
// Form input binding validation
//
// Every form element that captures user input — `textInput`, `textarea`
// (multi-line text), `checkbox` (checkbox group), and `radio` (radio group) —
// must declare an `outputParameter` binding. Without one, the runtime's
// `captureFormOutputs` (engines/web/src/properties.ts) skips the element on
// submit (`if (!('outputParameter' in el) || !el.outputParameter) continue`)
// and the user's input is silently discarded — any downstream step that
// reads the property the author *thought* the field wrote to gets an empty
// string. That's exactly how the Kitchen workflow's BakeItem hit `int('')`
// after the "Get Test Info" form's three inputs all had auto-generated
// fieldNames (`Text_127680`, `Radio_547520`, `Radio_282752`) but no
// `outputParameter` linking them to the step's output spec.
//
// This was a fatal reject (error code UNBOUND_FORM_INPUT) from 2026-05-29 until
// 2026-08-10, when user testing ruled it too strict for the Pro runtime: an
// unbound element is authoring sloppiness the run survives by design (the value
// is discarded, nothing corrupts), so killing the instance at start punishes the
// operator for the author's mistake. The walk now collects NON-FATAL warnings —
// one per unbound element, all of them, not first-hit — which instance start
// surfaces as WARNING trace rows. This diverges from the reference validator at
// the vendored conformance commit (see conformance/PROVENANCE.md); the live
// TrajectoryRuntime engines adopted the same downgrade on 2026-08-10 (e248fd1).
// ────────────────────────────────────────────────────────────────────────────

const INPUT_BINDING_REQUIRED_TYPES: ReadonlySet<string> = new Set([
  'textInput',
  'textarea',
  'checkbox',
  'radio',
  'esignature',
])

function formInputBindingWarnings(workflow: Record<string, unknown>): ValidationWarning[] {
  const warnings: ValidationWarning[] = []
  function checkSpec(spec: Record<string, unknown>): void {
    const steps = (spec['steps'] as Record<string, unknown>[] | undefined) ?? []
    for (const step of steps) {
      const stepLabel = (step['local_id'] as string | undefined) ?? (step['oid'] as string | undefined) ?? '<unknown>'
      const layouts = step['form_layout_config'] as
        | Array<Record<string, unknown>>
        | undefined
      if (Array.isArray(layouts)) {
        for (const layout of layouts) {
          const elements = layout['elements'] as Record<string, unknown>[] | undefined
          if (!Array.isArray(elements)) continue
          for (const el of elements) {
            const type = el['type'] as string | undefined
            if (!type || !INPUT_BINDING_REQUIRED_TYPES.has(type)) continue
            const outputParameter = el['outputParameter']
            if (typeof outputParameter !== 'string' || outputParameter.length === 0) {
              const fieldName = (el['fieldName'] as string | undefined) ?? ''
              const label = (el['label'] as string | undefined) ?? fieldName ?? '(unlabeled)'
              const device = (layout['deviceType'] as string | undefined) ?? 'unknown'
              warnings.push({
                code: 'UNBOUND_FORM_INPUT',
                message:
                  `Step "${stepLabel}" form ${type} "${label}" (${device} layout) has no outputParameter binding — ` +
                  `captured input will be discarded. Set the element's outputParameter to one of the step's ` +
                  `output_parameter_specifications ids, or remove the element.`,
              })
            }
          }
        }
      }
      collectFormDocumentBindingWarnings(step, stepLabel, warnings)
      collectESignatureWarnings(step, stepLabel, warnings)
    }
    const childSpecs = spec['children'] as Record<string, unknown>[] | undefined
    if (Array.isArray(childSpecs)) {
      for (const c of childSpecs) checkSpec(c)
    }
  }
  checkSpec(workflow)
  return warnings
}

/** ENGINE DIVERGENCE (5.0 envelope): the same UNBOUND_FORM_INPUT rule, applied to
 *  form_document blocks. Same required-types set as the v1 walk — deliberately not
 *  timer (no invented strictness beyond the reference rule). */
function collectFormDocumentBindingWarnings(
  step: Record<string, unknown>,
  stepLabel: string,
  warnings: ValidationWarning[],
): void {
  const doc = step['form_document'] as Record<string, unknown> | undefined
  const sections = doc?.['sections'] as Array<Record<string, unknown>> | undefined
  if (!Array.isArray(sections)) return
  for (const section of sections) {
    const rows = section['rows'] as Array<Record<string, unknown>> | undefined
    if (!Array.isArray(rows)) continue
    for (const row of rows) {
      const blocks = row['blocks'] as Record<string, unknown>[] | undefined
      if (!Array.isArray(blocks)) continue
      for (const el of blocks) {
        const type = el['type'] as string | undefined
        if (!type || !INPUT_BINDING_REQUIRED_TYPES.has(type)) continue
        const outputParameter = el['outputParameter']
        if (typeof outputParameter !== 'string' || outputParameter.length === 0) {
          const fieldName = (el['fieldName'] as string | undefined) ?? ''
          const label = (el['label'] as string | undefined) ?? fieldName ?? '(unlabeled)'
          warnings.push({
            code: 'UNBOUND_FORM_INPUT',
            message:
              `Step "${stepLabel}" form ${type} "${label}" (form_document layout) has no outputParameter binding — ` +
              `captured input will be discarded. Set the element's outputParameter to one of the step's ` +
              `output_parameter_specifications ids, or remove the element.`,
          })
        }
      }
    }
  }
}

/** Spec 2026-09-06 D9: at most one e-signature block is meaningful — the engine signs with the
 *  first in document order. More than one is authoring drift, surfaced as a WARNING trace at start. */
function collectESignatureWarnings(step: Record<string, unknown>, stepLabel: string, warnings: ValidationWarning[]): void {
  const doc = step['form_document'] as Record<string, unknown> | undefined
  const sections = doc?.['sections'] as Array<Record<string, unknown>> | undefined
  if (!Array.isArray(sections)) return
  let count = 0
  for (const section of sections) {
    const rows = section['rows'] as Array<Record<string, unknown>> | undefined
    if (!Array.isArray(rows)) continue
    for (const row of rows) {
      const blocks = row['blocks'] as Record<string, unknown>[] | undefined
      if (!Array.isArray(blocks)) continue
      for (const el of blocks) if (el['type'] === 'esignature') count++
    }
  }
  if (count > 1) {
    warnings.push({
      code: 'ESIGNATURE_MULTIPLE_BLOCKS',
      message: `Step "${stepLabel}" form_document holds ${count} e-signature blocks — only the first in document order is signed; remove the others.`,
    })
  }
}

// Relax form element `required` arrays in the schema so that elements
// missing optional-in-practice fields (fieldName, label, etc.) still
// validate.  We keep only `["type"]` so invalid element types are caught.
function relaxFormElementRequired(schema: Record<string, unknown>): void {
  const defs = schema['$defs'] as Record<string, unknown> | undefined;
  if (!defs) return;

  const formElementNames = [
    'FormElementButton', 'FormElementText', 'FormElementHeader',
    'FormElementTextInput', 'FormElementTextarea', 'FormElementImage',
    'FormElementVideo', 'FormElementCheckbox', 'FormElementRadio',
    'FormElementDivider', 'FormElementTimer',
  ];

  for (const name of formElementNames) {
    const def = defs[name] as Record<string, unknown> | undefined;
    if (!def?.allOf) continue;
    const allOf = def.allOf as Record<string, unknown>[];
    for (const part of allOf) {
      if (part.properties && (part.properties as Record<string, unknown>).type) {
        // Keep only 'type' as required
        part.required = ['type'];
      }
    }
  }
}

// Structural validation via ajv
let cachedSchema: Record<string, unknown> | null = null;

function loadSchema(): Record<string, unknown> {
  if (cachedSchema) return cachedSchema;
  // Deep-clone the imported JSON before mutating it — ESM JSON-module imports are cached
  // singletons (a second `import` of the same specifier anywhere returns the SAME object), so
  // mutating it in place would be mutating the module's own cache, not a private copy.
  const raw = JSON.parse(JSON.stringify(workflowSchemaRaw)) as Record<string, unknown>;
  // Remove $schema since ajv doesn't support 2020-12 out of the box
  delete raw['$schema'];
  // Relax form element required fields — fixtures have elements
  // without fieldName/label/outputValue that are still valid.
  // Keep only the 'type' const so invalid types are still caught.
  relaxFormElementRequired(raw);
  cachedSchema = raw;
  return cachedSchema;
}

// Final-review bundled fix (recommendation alongside C1): compile the ajv validator ONCE and
// reuse it. structuralValidation previously constructed a fresh `new Ajv(...)` + `ajv.compile`
// on EVERY call — i.e. on every single instance start, synchronously, WHILE the acquire+start
// transaction is open — a proven-plausible amplifier of the real-PG "1-in-17" timeout the final
// review flagged. The schema never changes at runtime (loadSchema's own module-level cache
// already assumes this), so the compiled validator is just as safe to memoize.
let cachedValidateFn: ValidateFunction | null = null;

function getValidateFn(): ValidateFunction {
  if (cachedValidateFn) return cachedValidateFn;
  const ajv = new Ajv({ allErrors: true, strict: false });
  cachedValidateFn = ajv.compile(loadSchema());
  return cachedValidateFn;
}

// Deep-clone workflow with SELECT_1 → SELECT 1 normalization for ajv
function normalizeForAjv(workflow: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(workflow)) as Record<string, unknown>;
  const steps = clone['steps'];
  if (Array.isArray(steps)) {
    for (const step of steps) {
      if (step?.step_type === 'SELECT_1') {
        step.step_type = 'SELECT 1';
      }
    }
  }
  return clone;
}

function structuralValidation(workflow: Record<string, unknown>): ValidationResult | null {
  const validateFn = getValidateFn();
  const valid = validateFn(normalizeForAjv(workflow));

  if (valid) return null;

  const errors = validateFn.errors ?? [];

  for (const err of errors) {
    const path = err.instancePath ?? '';
    const keyword = err.keyword;

    if (keyword === 'oneOf' && path.includes('elements')) {
      return { valid: false, error_code: 'INVALID_FORM_ELEMENT_TYPE', error_message: `Invalid form element at ${path}` };
    }

    if (keyword === 'enum' && path.includes('step_type')) {
      return { valid: false, error_code: 'INVALID_STEP_TYPE', error_message: `Invalid step type at ${path}` };
    }

    if (keyword === 'required') {
      return { valid: false, error_code: 'MISSING_REQUIRED_FIELD', error_message: `Missing required field: ${err.params?.missingProperty} at ${path}` };
    }
  }

  // Fallback: form element type failures via const mismatches
  const hasOneOfFail = errors.some((e: ErrorObject) => e.keyword === 'oneOf');
  const hasConstFails = errors.some((e: ErrorObject) => e.keyword === 'const' && e.instancePath?.includes('/type'));
  if (hasOneOfFail && hasConstFails) {
    return { valid: false, error_code: 'INVALID_FORM_ELEMENT_TYPE', error_message: 'Invalid form element type' };
  }

  return { valid: false, error_code: 'MISSING_REQUIRED_FIELD', error_message: errors[0]?.message ?? 'Validation failed' };
}

function actionServerUriValidation(workflow: Record<string, unknown>): ValidationResult | null {
  const envSpecs =
    (workflow['environment_specifications'] as Array<Record<string, unknown>> | undefined) ?? [];
  for (const env of envSpecs) {
    const servers =
      (env['action_server_specifications'] as Array<Record<string, unknown>> | undefined) ?? [];
    for (const s of servers) {
      const uri = s['uri'];
      // A blank URI is allowed: the server is bound per work center in Mission Commander.
      if (uri === undefined || uri === null || (typeof uri === 'string' && uri.trim() === '')) continue;
      if (typeof uri !== 'string' || !hasValidServerUriScheme(uri)) {
        const envName = String(env['local_id'] ?? env['oid'] ?? '');
        const serverName = String(s['name'] || '(unnamed)');
        return {
          valid: false,
          error_code: 'INVALID_VALIDATION',
          error_message: `Environment "${envName}" has an action server "${serverName}" with an invalid URI "${String(uri)}". Fix it in Designer, then re-export and re-load the workflow.`,
        };
      }
    }
  }
  return null;
}

export function validate(workflow: Record<string, unknown>): ValidationResult {
  // Phase 0: Pre-structural (missing required fields on steps/connections)
  const preError = preStructuralChecks(workflow);
  if (preError) return preError;

  // Phase A: Semantic checks (graph analysis)
  const semanticError = semanticValidation(workflow);
  if (semanticError) return semanticError;

  // Phase A1.5: TRY/CATCH/RETURN structural + cross-reference + topology rules
  const tryCatchError = tryCatchValidation(workflow);
  if (tryCatchError) return tryCatchError;

  // Phase A1.6: GATE structural rules (spec 2026-08-29 §6.6) — degree + cycle_seconds.
  const gateError = gateValidation(workflow);
  if (gateError) return gateError;

  // Phase A1.7: repeating SCRIPT rules (spec 2026-10-13 §6.1).
  const scriptError = scriptValidation(workflow);
  if (scriptError) return scriptError;

  // Phase A2: ACTION PROXY config validation (§14.2)
  const actionProxyError = actionProxyValidation(workflow);
  if (actionProxyError) return actionProxyError;

  // Phase A2.5: action-server URI scheme check (SSRF — reject non-http(s) URIs)
  const serverUriError = actionServerUriValidation(workflow);
  if (serverUriError) return serverUriError;

  // Phase A3: Resource validation
  const resourceError = resourceValidation(workflow);
  if (resourceError) return resourceError;

  // Phase A4: Form input binding check — every textInput / textarea / checkbox /
  // radio element should declare an outputParameter or its captured value is
  // silently discarded by captureFormOutputs at runtime. NON-FATAL since
  // 2026-08-10 (see the divergence note above formInputBindingWarnings): the
  // findings ride along on a successful result as warnings instead of rejecting.
  const formInputWarnings = formInputBindingWarnings(workflow);

  // Phase A4.5: binding-resolution advisories (both homes) (GATE spec 2026-08-29 §6.6; spec
  // 2026-09-04 §5.4.7) — same non-fatal shape as Phase A4 above: an unresolvable environment or
  // parameter_id is a runtime (TRY-routable) concern for that step, not a spec-validity concern.
  const bindingAdvisories = bindingWarnings(workflow);

  // Phase B: Structural validation (ajv)
  const structuralError = structuralValidation(workflow);
  if (structuralError) return structuralError;

  const allWarnings = [...formInputWarnings, ...bindingAdvisories];
  return allWarnings.length > 0 ? { valid: true, warnings: allWarnings } : { valid: true };
}

export { validate as validateWorkflow };
