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
import * as vm from 'node:vm';
import { types as utilTypes } from 'node:util';
import type {
  MasterWorkflowStep,
  FormElement,
  FormLayoutExportEntry,
  UserAction,
  RoutingResult,
  Select1Option,
  OutputParameterSpecification,
  CatchContext,
  ScriptRepeatConfig,
} from '../spec/types.js';
import type { PropertyStore } from './properties.js';

// Normalize only SELECT_1 → SELECT 1 (the only fixture/schema discrepancy).
// USER_INTERACTION and YES_NO keep their underscores per the schema enum.
export function canonicalStepType(raw: string): string {
  if (raw === 'SELECT_1') return 'SELECT 1';
  return raw;
}

export function isAutoCompleting(stepType: string): boolean {
  const t = canonicalStepType(stepType);
  return ['START', 'END', 'PARALLEL', 'WAIT ANY', 'SELECT 1', 'SCRIPT', 'MATH', 'CATCH', 'RETURN'].includes(t);
}

export function needsUserAction(stepType: string): boolean {
  return ['USER_INTERACTION', 'YES_NO', 'ACTION PROXY'].includes(stepType);
}

export function getFormElements(step: MasterWorkflowStep): FormElement[] {
  const config = step.form_layout_config;
  if (config) {
    // Handle array of breakpoints — use first one (phone)
    if (Array.isArray(config)) {
      const entries = config as FormLayoutExportEntry[];
      if (entries.length === 0) return [];
      return entries[0].elements ?? [];
    }

    // Handle plain object shape (some semantic fixtures use this)
    if (typeof config === 'object' && 'elements' in config) {
      return (config as { elements: FormElement[] }).elements ?? [];
    }

    return [];
  }

  // ENGINE DIVERGENCE from the reference port (which predates the 5.0 envelope):
  // fall back to the v2 form_document (sections -> rows -> blocks). Capture keys on
  // fieldName/outputParameter; block geometry is presentation-only, zeroed here.
  const doc = step.form_document as
    | { sections?: Array<{ rows?: Array<{ blocks?: Array<Record<string, unknown>> }> }> }
    | undefined;
  if (!doc || !Array.isArray(doc.sections)) return [];
  const out: FormElement[] = [];
  for (const section of doc.sections) {
    if (!Array.isArray(section?.rows)) continue;
    for (const row of section.rows) {
      if (!Array.isArray(row?.blocks)) continue;
      for (const block of row.blocks) {
        const fieldName = block['fieldName'];
        if (typeof fieldName !== 'string' || fieldName.length === 0) continue;
        out.push({
          type: typeof block['type'] === 'string' && block['type'].length > 0 ? block['type'] : 'textInput',
          x: 0, y: 0, width: 0, height: 0,
          fieldName,
          ...(typeof block['label'] === 'string' ? { label: block['label'] } : {}),
          ...(typeof block['outputParameter'] === 'string' ? { outputParameter: block['outputParameter'] } : {}),
        } as unknown as FormElement);
      }
    }
  }
  return out;
}

export function handleSelect1(
  step: MasterWorkflowStep,
  propertyStore: PropertyStore,
): RoutingResult {
  const config = step.select1_config;
  if (!config || !config.options) {
    return {};
  }

  // Spec 2026-09-04 D9: the step's own RESOLVED input parameters win over the property store,
  // so a bound Action Property routed through an Input Parameter can drive the branch.
  const inputs = propertyStore.getInputParameters();

  // Resolve the input value
  let inputValue = '';
  if (config.input_value_type === 'property' && config.input_name) {
    inputValue = inputs[config.input_name] ?? propertyStore.get(config.input_name) ?? '';
  } else if (config.input_name) {
    inputValue = config.input_name;
  }

  // Evaluate options in order
  let defaultOption: Select1Option | undefined;
  for (const option of config.options) {
    if (option.is_default) {
      defaultOption = option;
      continue;
    }

    const compareValue = option.value_type === 'property'
      ? (inputs[option.value] ?? propertyStore.get(option.value) ?? '')
      : option.value;

    if (evaluateOperator(inputValue, option.operator, compareValue)) {
      return { connectionId: option.id };
    }
  }

  // No match — use default
  if (defaultOption) {
    return { connectionId: defaultOption.id };
  }

  return {};
}

function evaluateOperator(input: string, operator: string, value: string): boolean {
  switch (operator) {
    case '==': return input === value;
    case '!=': return input !== value;
    case '<': return input < value;
    case '>': return input > value;
    case '<=': return input <= value;
    case '>=': return input >= value;
    case 'Contains': return input.includes(value);
    case 'Not Contains': return !input.includes(value);
    default: return false;
  }
}

export function handleUserAction(
  step: MasterWorkflowStep,
  action: UserAction,
  propertyStore: PropertyStore,
): RoutingResult {
  const stepType = step.step_type;

  if (stepType === 'YES_NO') {
    // YES_NO is a routing step — the button output drives routing via sourceHandleId/condition.
    // Parameter writes only come from form elements with `outputParameter` bindings; the button
    // literal is never written to output_parameter_specifications.
    if (action.form_values) {
      const elements = getFormElements(step);
      propertyStore.captureFormOutputs(elements, action.form_values, step.output_parameter_specifications);
    }
    return { conditionValue: action.button_output, sourceHandleId: action.button_output ?? '', excludeUnconditional: true };
  }

  if (stepType === 'USER_INTERACTION') {
    // Capture form outputs, resolving through output_parameter_specifications for full dotted target paths
    if (action.form_values) {
      const elements = getFormElements(step);
      propertyStore.captureFormOutputs(elements, action.form_values, step.output_parameter_specifications);
    }

    if (action.action === 'button_press') {
      return { conditionValue: action.button_output };
    }

    return {};
  }

  return {};
}

export interface ScriptResult {
  success: boolean;
  error?: string;
}

/**
 * Map a SCRIPT (or GATE) execution failure to a user-facing message.
 *
 * SCRIPT and GATE steps both run server-side, in the Mission Engine sandbox,
 * via `vm.runInNewContext` (see `executeScript` and `executeGateScript`
 * below) — never via `eval`/`new Function()` in a browser page.
 *
 * A script's own throws — compile errors included, since the source is compiled inside the
 * sandbox — are caught and String()-ed THERE (under the vm timeout), so the `"Error: <message>"`
 * form comes from there. The host normally sees only the vm's own timeout Error. Nothing here
 * ever String()s, uses `instanceof` on, or reads through a value a script could have built —
 * that would run its code on the host with no timeout.
 */
export function scriptErrorMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (!utilTypes.isNativeError(err) || utilTypes.isProxy(err)) return SCRIPT_UNREADABLE_ERROR;
  const message = ownDataString(err, 'message');
  if (message === undefined) return SCRIPT_UNREADABLE_ERROR;
  if (protoChainReaches(err, Error.prototype)) return message; // a host error: the vm timeout
  const name = ownDataString(Object.getPrototypeOf(err), 'name') ?? 'Error';
  return `${name}: ${message}`;
}

/** True when `target` is on obj's prototype chain — walked with Object.getPrototypeOf, stopping
 *  at any proxy, so no trap ever runs (unlike `instanceof`). */
function protoChainReaches(obj: object, target: object): boolean {
  let p: unknown = obj;
  for (let depth = 0; depth < 16; depth++) {
    if (p === null || typeof p !== 'object' || utilTypes.isProxy(p)) return false;
    p = Object.getPrototypeOf(p);
    if (p === target) return true;
  }
  return false;
}

/** For process 'unhandledRejection': true for a promise made by a script (another realm's
 *  Promise), so the engine can drop it instead of exiting — Node's default for an unhandled
 *  rejection is to crash the process, and `Promise.reject(1)` in a script must not do that.
 *  The engine's own promises (and subclasses of this realm's Promise) return false. */
export function isSandboxPromise(promise: unknown): boolean {
  return promise !== null && typeof promise === 'object' && !protoChainReaches(promise, Promise.prototype);
}

/** Process 'unhandledRejection' listener: a script's rejected promise is dropped with a constant
 *  log line (its reason is never read — converting it would run script code outside the vm
 *  timeout); the engine's own rejections keep Node's default and take the process down. */
export function installScriptRejectionGuard(): void {
  process.on('unhandledRejection', (reason, promise) => {
    if (isSandboxPromise(promise)) {
      console.warn('[script] a script left a rejected promise unhandled; ignored');
      return;
    }
    throw reason instanceof Error ? reason : new Error(`Unhandled rejection: ${String(reason)}`);
  });
}

/** The message for a script failure whose error value cannot be read safely. */
export const SCRIPT_UNREADABLE_ERROR = 'Script failed (its error could not be read)';

/** obj[key] only when it is an own data property holding a string — never a getter or proxy trap. */
function ownDataString(obj: unknown, key: string): string | undefined {
  if (obj === null || typeof obj !== 'object' || utilTypes.isProxy(obj)) return undefined;
  const d = Object.getOwnPropertyDescriptor(obj, key);
  return d && 'value' in d && typeof d.value === 'string' ? d.value : undefined;
}

/**
 * Execute a SCRIPT step's source code via `node:vm`.
 *
 * Input parameters are injected as local variables (by their spec id).
 * An `output` object is provided for the script to write results to.
 * After execution, output keys are mapped through output_parameter_specifications
 * into the PropertyStore.
 */
export function executeScript(
  step: MasterWorkflowStep,
  propertyStore: PropertyStore,
  inputParameters: Record<string, string>,
  scriptTimeoutMs: number,
): ScriptResult {
  const config = step.script_config;
  if (!config?.source) {
    return { success: true }; // No source — pass through
  }

  let raw: unknown;
  try {
    raw = runInSandbox(SCRIPT_WRAPPER, sandboxData(step, inputParameters, config.source), scriptTimeoutMs);
  } catch (err) {
    return { success: false, error: scriptErrorMessage(err) };
  }

  const envelope = readSandboxEnvelope(raw);
  if (typeof envelope.error === 'string') return { success: false, error: envelope.error };
  commitScriptOutputs(step, propertyStore, envelope.output ?? {});
  return { success: true };
}

/** A SCRIPT run's `output` object as stored and committed: each value String()-ed, `undefined`
 *  kept as `null` (a key the script named but left unset). JSON-safe, so a repeating script's
 *  pending outputs can sit in engine_state between runs (spec 2026-10-13 §6.2). */
export type ScriptOutputs = Record<string, string | null>;

/**
 * How every SCRIPT and GATE runs. The wrappers below are fixed engine text: no author text is
 * ever spliced into them. The author's source, input names, input values and output keys go in
 * as STRING globals on a null-prototype sandbox (so no host object — and no host prototype — is
 * reachable from inside), and the source is compiled inside the sandbox with that realm's
 * `Function`, so it cannot close the wrapper and run outside its catches. Promise callbacks run
 * before runInNewContext returns, under the same timeout (microtaskMode 'afterEvaluate').
 */
function runInSandbox(wrapper: string, data: Record<string, string>, timeoutMs: number): unknown {
  const sandbox: Record<string, string> = Object.create(null) as Record<string, string>;
  Object.assign(sandbox, data);
  return vm.runInNewContext(wrapper, sandbox, { timeout: timeoutMs, microtaskMode: 'afterEvaluate' });
}

/** Captured before the script body runs, so a script that reassigns JSON / String / Object /
 *  Function / Function.prototype.call cannot change how its own results are read back. Everything
 *  that can run script code (getters, toJSON, toString) happens INSIDE the sandbox, under the vm
 *  timeout; the host only JSON.parses the single string the wrapper returns, then checks its
 *  shape. `__env` copies an envelope's fields onto a null-prototype object, so an
 *  Object.prototype.toJSON the script planted is never consulted when the envelope is serialised.
 *  `__convert` turns the script's `output` into ScriptOutputs: with output keys (the spec ids)
 *  only those are read — an unmapped key is never touched; with `null`, every own key. */
const SANDBOX_PRELUDE = [
  'const __J = JSON.stringify, __P = JSON.parse, __S = String, __keysOf = Object.keys, __has = Object.prototype.hasOwnProperty,',
  '  __apply = Reflect.apply, __mk = Object.create, __F = Function;',
  'const __env = function(f) { const e = __mk(null); const ks = ["error", "output", "done", "stateJson", "open"];',
  '  for (let i = 0; i < ks.length; i++) { const k = ks[i]; if (__apply(__has, f, [k])) e[k] = f[k]; } return e; };',
  'const __compile = function(params, body) { return __apply(__F, undefined, params.concat([body])); };',
  'const __convert = function(out, keys) { const o = __mk(null); const ks = keys === null ? __keysOf(out) : keys;',
  '  for (let i = 0; i < ks.length; i++) { const k = ks[i]; if (!__apply(__has, out, [k])) continue;',
  '    const v = out[k]; o[k] = v === undefined ? null : __S(v); } return o; };',
].join('\n');

/** The wrapper's outermost catch: a constant string, built without calling anything, so even an
 *  error whose toString throws another such error cannot leave the sandbox — the vm timeout
 *  Error is all the host ever sees. */
const SANDBOX_OUTER_CATCH = `} catch (__unreadable) { return ${JSON.stringify(JSON.stringify({ error: SCRIPT_UNREADABLE_ERROR }))}; }`;

/** The data every wrapper reads: input names and values, and the output keys to convert. The
 *  author's code can overwrite these globals, so each wrapper reads them all before it runs. */
function sandboxData(step: MasterWorkflowStep, inputParameters: Record<string, string>, body: string): Record<string, string> {
  const names = Object.keys(inputParameters);
  const specs = step.output_parameter_specifications;
  return {
    __names: JSON.stringify(names),
    __argv: JSON.stringify(names.map(k => inputParameters[k])),
    __outKeys: JSON.stringify(specs && specs.length > 0 ? specs.map(sp => sp.id) : null),
    __src: body,
  };
}

/** One-shot SCRIPT: inputs as locals, `output` collects results. */
const SCRIPT_WRAPPER = [
  '(function() {', SANDBOX_PRELUDE, 'try {', 'const __output = {}, __keys = __P(__outKeys);',
  'try {',
  "const __fn = __compile(__P(__names).concat(['output']), __src);",
  '__apply(__fn, undefined, __P(__argv).concat([__output]));',
  'return __J(__env({ output: __convert(__output, __keys) }));',
  '} catch (e) { return __J(__env({ error: __S(e) })); }',
  SANDBOX_OUTER_CATCH,
  '})()',
].join('\n');

/** Repeating SCRIPT: adds `state`. The author's source runs in an inner function so `state = {...}`
 *  rebinds the parameter the body then returns; a source that tampers with that return only
 *  changes its own result. */
const REPEAT_WRAPPER = [
  '(function() {', SANDBOX_PRELUDE, 'try {', 'const __output = {}, __keys = __P(__outKeys);',
  "const __state = __stateIn === '' ? {} : __P(__stateIn);",
  'let __done, __kept;',
  'try {',
  "const __fn = __compile(__P(__names).concat(['output', 'state']), __src);",
  'const __ran = __apply(__fn, undefined, __P(__argv).concat([__output, __state]));',
  '__done = __ran[0] === true; __kept = __ran[1];',
  '} catch (e) { return __J(__env({ error: __S(e) })); }',
  'let __stateJson;',
  "try { __stateJson = __J(__kept); } catch (e) { return __J(__env({ error: 'Script state is not JSON' })); }",
  'let __out;',
  'try { __out = __convert(__output, __keys); } catch (e) { return __J(__env({ error: __S(e) })); }',
  'return __J(__env({ done: __done, stateJson: __stateJson === undefined ? null : __stateJson, output: __out }));',
  SANDBOX_OUTER_CATCH,
  '})()',
].join('\n');

/** The function body a repeating script compiles to: its source in an inner function, then the
 *  verdict and the (possibly reassigned) state. */
function repeatBody(source: string): string {
  return `const __result = (function() {\n${source}\n})();\nreturn [__result === true, state];`;
}

/** GATE: inputs as locals, no `output`; the return value is truthiness-coerced in the sandbox. */
const GATE_WRAPPER = [
  '(function() {', SANDBOX_PRELUDE, 'try {',
  'try {',
  'const __verdict = __apply(__compile(__P(__names), __src), undefined, __P(__argv));',
  'return __J(__env({ open: __verdict ? true : false }));',
  '} catch (e) { return __J(__env({ error: __S(e) })); }',
  SANDBOX_OUTER_CATCH,
  '})()',
].join('\n');

interface SandboxEnvelope { error?: string; output?: ScriptOutputs; done?: boolean; stateJson?: string | null; open?: boolean }

const UNREADABLE_RESULT: SandboxEnvelope = { error: 'Script result is not readable' };

/** Parse the wrapper's one string and check its shape: every field is optional, but a field that
 *  is present must have its declared type, and output values must be string | null. */
export function readSandboxEnvelope(raw: unknown): SandboxEnvelope {
  if (typeof raw !== 'string') return UNREADABLE_RESULT;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return UNREADABLE_RESULT;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return UNREADABLE_RESULT;
  const e = parsed as Record<string, unknown>;
  if (e.error !== undefined && typeof e.error !== 'string') return UNREADABLE_RESULT;
  if (e.done !== undefined && typeof e.done !== 'boolean') return UNREADABLE_RESULT;
  if (e.open !== undefined && typeof e.open !== 'boolean') return UNREADABLE_RESULT;
  if (e.stateJson !== undefined && e.stateJson !== null && typeof e.stateJson !== 'string') return UNREADABLE_RESULT;
  if (e.output !== undefined) {
    if (!e.output || typeof e.output !== 'object' || Array.isArray(e.output)) return UNREADABLE_RESULT;
    if (Object.values(e.output).some(v => v !== null && typeof v !== 'string')) return UNREADABLE_RESULT;
  }
  return e as SandboxEnvelope;
}

/** The one SCRIPT commit rule: with output_parameter_specifications, each spec whose id the
 *  script set writes its target ('' for a key left undefined); without specs, each key the
 *  script set to a value is written directly as a dotted property. */
export function commitScriptOutputs(step: MasterWorkflowStep, propertyStore: PropertyStore, outputs: ScriptOutputs): void {
  const outputSpecs = step.output_parameter_specifications;
  if (outputSpecs && outputSpecs.length > 0) {
    for (const spec of outputSpecs) {
      if (Object.prototype.hasOwnProperty.call(outputs, spec.id) && spec.target) {
        propertyStore.set(spec.target, outputs[spec.id] ?? '');
      }
    }
    return;
  }
  for (const [key, val] of Object.entries(outputs)) {
    if (val !== null) propertyStore.set(key, val);
  }
}

// ── Repeating SCRIPT (spec 2026-10-13 §6) ──

export const SCRIPT_DEFAULT_CYCLE_SECONDS = 5;
/** §6.2: the most a repeating script may keep in `state`, as UTF-8 bytes of its JSON. */
export const SCRIPT_STATE_MAX_BYTES = 65_536;
/** The most one run of a repeating script may put in `output`, as UTF-8 bytes of its JSON. */
export const SCRIPT_OUTPUTS_MAX_BYTES = 65_536;

/** The step's repeat settings, or null for a one-shot SCRIPT. */
export function scriptRepeat(step: MasterWorkflowStep): ScriptRepeatConfig | null {
  const r = step.script_config?.repeat;
  return r && typeof r === 'object' && !Array.isArray(r) ? r : null;
}

export function scriptCycleSeconds(step: MasterWorkflowStep): number {
  const c = scriptRepeat(step)?.cycle_seconds;
  return typeof c === 'number' && c >= 1 ? c : SCRIPT_DEFAULT_CYCLE_SECONDS;
}

/** started_at + time_limit_seconds; null when there is no limit (or no start). */
export function scriptLimitDeadline(step: MasterWorkflowStep, startedAt: Date | null): Date | null {
  const limit = scriptRepeat(step)?.time_limit_seconds;
  if (typeof limit !== 'number' || !startedAt) return null;
  return new Date(startedAt.getTime() + limit * 1000);
}

export function scriptExpired(step: MasterWorkflowStep, now: Date, startedAt: Date | null): boolean {
  const deadline = scriptLimitDeadline(step, startedAt);
  return deadline !== null && now.getTime() >= deadline.getTime();
}

/** §6.2: the next run is one cycle away, but never later than the time limit. */
export function nextScriptWake(step: MasterWorkflowStep, now: Date, startedAt: Date | null): Date {
  const cycle = new Date(now.getTime() + scriptCycleSeconds(step) * 1000);
  const deadline = scriptLimitDeadline(step, startedAt);
  return deadline && deadline.getTime() < cycle.getTime() ? deadline : cycle;
}

export function scriptOnTimeLimit(step: MasterWorkflowStep): 'error' | 'complete' {
  return scriptRepeat(step)?.on_time_limit === 'complete' ? 'complete' : 'error';
}

/** A repeating script with step-level Action-Property bindings fetches them before every run,
 *  outside the instance lock — the gate's two-phase path (§6.2). */
export function scriptUsesBindings(step: MasterWorkflowStep): boolean {
  return (step.action_property_bindings?.length ?? 0) > 0;
}

export interface RepeatRunResult {
  success: boolean;
  error?: string;
  /** The script returned exactly `true`. */
  done: boolean;
  /** This run's output object — committed only when the step completes. */
  output: ScriptOutputs;
  /** The state after this run: JSON data, already size-checked. */
  state: unknown;
}

/**
 * One run of a repeating SCRIPT (§6.2). Like executeScript, inputs are positional locals named
 * by spec id and `output` collects results; it adds `state`, a JSON object the run may mutate
 * OR reassign (the body runs in an inner function, so `state = {...}` rebinds the outer
 * parameter the wrapper returns). Nothing is committed here: the caller decides whether the
 * outputs become pending or final. No source → done at once (executeScript's pass-through).
 */
export function runRepeatingScript(
  step: MasterWorkflowStep,
  inputParameters: Record<string, string>,
  previousState: unknown,
  scriptTimeoutMs: number,
): RepeatRunResult {
  const source = step.script_config?.source;
  if (!source) {
    const startState: unknown = previousState === undefined ? {} : JSON.parse(JSON.stringify(previousState));
    return { success: true, done: true, output: {}, state: startState };
  }
  let raw: unknown;
  try {
    // state and output are built inside the sandbox (never host objects the script could reach
    // through); state serialisation and output String()-ing run there too, under the timeout.
    const data = sandboxData(step, inputParameters, repeatBody(source));
    data.__stateIn = previousState === undefined ? '' : JSON.stringify(previousState);
    raw = runInSandbox(REPEAT_WRAPPER, data, scriptTimeoutMs);
  } catch (err) {
    return { success: false, error: scriptErrorMessage(err), done: false, output: {}, state: previousState };
  }
  const envelope = readSandboxEnvelope(raw);
  if (typeof envelope.error === 'string') return { success: false, error: envelope.error, done: false, output: {}, state: previousState };
  const json = typeof envelope.stateJson === 'string' ? envelope.stateJson : undefined;
  if (json !== undefined && Buffer.byteLength(json, 'utf8') > SCRIPT_STATE_MAX_BYTES) {
    return { success: false, error: 'Script state exceeds 64 KB', done: false, output: {}, state: previousState };
  }
  const output = envelope.output ?? {};
  // Pending outputs sit in engine_state between runs, so they get the same 64 KB budget as state.
  if (Buffer.byteLength(JSON.stringify(output), 'utf8') > SCRIPT_OUTPUTS_MAX_BYTES) {
    return { success: false, error: 'Script outputs exceed 64 KB', done: false, output: {}, state: previousState };
  }
  return {
    success: true,
    done: envelope.done === true,
    output,
    state: json === undefined ? {} : JSON.parse(json),
  };
}

export const GATE_DEFAULT_CYCLE_SECONDS = 5;

export function gateCycleSeconds(step: MasterWorkflowStep): number {
  const c = step.gate_config?.cycle_seconds;
  return typeof c === 'number' && c >= 1 ? c : GATE_DEFAULT_CYCLE_SECONDS;
}

export type GateMode = 'condition' | 'timer' | 'condition_or_timer';

/** Spec 2026-10-13 §3.1: absent or unknown = 'condition', so every pre-existing gate keeps
 *  its exact behavior. */
export function gateMode(step: MasterWorkflowStep): GateMode {
  const m = step.gate_config?.mode;
  return m === 'timer' || m === 'condition_or_timer' ? m : 'condition';
}

/** started_at + delay_seconds for a timed gate; null for a condition gate or when either
 *  input is missing. started_at is the activation (or arming) time — spec §3.3. */
export function gateDeadline(step: MasterWorkflowStep, startedAt: Date | null): Date | null {
  if (gateMode(step) === 'condition') return null;
  const d = step.gate_config?.delay_seconds;
  if (typeof d !== 'number' || !startedAt) return null;
  return new Date(startedAt.getTime() + d * 1000);
}

/** A timed gate whose deadline has passed — or that has no computable deadline at all, which
 *  the validator forbids but must never turn into a wake-now loop. Never true for 'condition'. */
export function gateExpired(step: MasterWorkflowStep, now: Date, startedAt: Date | null): boolean {
  if (gateMode(step) === 'condition') return false;
  const deadline = gateDeadline(step, startedAt);
  return deadline === null || now.getTime() >= deadline.getTime();
}

/** The next wake_at for a parked gate (spec §3.4): a timer sleeps to its deadline; a
 *  condition_or_timer gate re-checks on its cycle but never sleeps past its deadline; a
 *  condition gate keeps today's now + cycle. */
export function nextGateWake(step: MasterWorkflowStep, now: Date, startedAt: Date | null): Date {
  const deadline = gateDeadline(step, startedAt);
  if (gateMode(step) === 'timer') return deadline ?? now;
  const cycle = new Date(now.getTime() + gateCycleSeconds(step) * 1000);
  return deadline && deadline.getTime() < cycle.getTime() ? deadline : cycle;
}

/** Bound gates fetch Action Properties outside the transaction before evaluating. A timer
 *  never runs its script, so it never fetches (plan deviation 4). */
export function gateUsesBindings(step: MasterWorkflowStep): boolean {
  return gateMode(step) !== 'timer' && (step.gate_config?.action_property_bindings?.length ?? 0) > 0;
}

const DURATION_UNITS: Array<[string, number]> = [['wk', 604_800], ['d', 86_400], ['h', 3_600], ['min', 60], ['s', 1]];

/** '2 h 10 min 20 s' — every non-zero unit, largest first; 0 → '0 s'. Same rule as
 *  Designer's lib/duration.ts formatDuration. */
export function formatDuration(seconds: number): string {
  let rest = Math.max(0, Math.floor(seconds));
  const parts: string[] = [];
  for (const [unit, size] of DURATION_UNITS) {
    const n = Math.floor(rest / size);
    rest -= n * size;
    if (n > 0) parts.push(`${n} ${unit}`);
  }
  return parts.length > 0 ? parts.join(' ') : '0 s';
}

export interface GateResult {
  success: boolean;
  /** Only meaningful when success — the script's returned verdict, JS-truthiness-coerced. */
  open?: boolean;
  error?: string;
}

/**
 * Execute a GATE step's script via node:vm and capture the wrapper IIFE's RETURN VALUE
 * (spec 2026-08-29 §5.4) — unlike executeScript, which discards it. Inputs inject as
 * positional locals named by spec id (all strings, same as SCRIPT); there is NO `output`
 * object (a GATE has no output parameters). No source → pass-through TRUE (mirrors
 * executeScript's no-source success and keeps everything about GATE optional in files).
 */
export function executeGateScript(
  step: MasterWorkflowStep,
  inputParameters: Record<string, string>,
  scriptTimeoutMs: number,
): GateResult {
  const source = step.gate_config?.source;
  if (!source) return { success: true, open: true };
  let raw: unknown;
  try {
    // Same wrapper discipline as SCRIPT: the verdict is truthiness-coerced and any throw String()-ed
    // inside the sandbox, so no script value is ever converted on the host (where no timeout runs).
    raw = runInSandbox(GATE_WRAPPER, sandboxData(step, inputParameters, source), scriptTimeoutMs);
  } catch (err) {
    return { success: false, error: scriptErrorMessage(err) };
  }
  const envelope = readSandboxEnvelope(raw);
  if (typeof envelope.error === 'string') return { success: false, error: envelope.error };
  return { success: true, open: envelope.open === true };
}

const KNOWN_CATCH_FIELDS: Record<string, (c: CatchContext) => string> = {
  Message: c => c.error_message ?? '',
  Reason: c => c.trigger_reason,
  Step: c => c.trigger_step_name,
  StepID: c => c.trigger_step_oid,
};

/** Spec §1.2 / §3.1: write the runtime-supplied trigger info to the CATCH's declared Value Property targets. */
export function activateCatchStep(
  step: MasterWorkflowStep,
  ctx: CatchContext,
  propertyStore: PropertyStore,
): void {
  for (const out of step.output_parameter_specifications ?? []) {
    const field = KNOWN_CATCH_FIELDS[out.id];
    if (!field || !out.target) continue; // unknown id: ignore silently (spec §1.2)
    propertyStore.set(out.target, field(ctx));
  }
}
