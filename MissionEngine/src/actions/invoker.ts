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
//
// Task 15: the seam ACTION PROXY activation dispatches through. `begin()` performs the ENTIRE
// resolve-environment-binding-then-invoke round trip (loop.ts's due-wake calls it OUTSIDE any
// open db transaction, per the project's "never hold a lock across slow I/O" posture) and never
// throws — network/allowlist/non-201 failures all come back as `{ok:false, error}` so callers
// can route them straight into failStep('ERROR') without a try/catch of their own.
//
// Two implementations:
//   - `nullActionInvoker`: `dispatches: false`, `client: null`. Task 9/10's original parking
//     behavior for ACTION PROXY — trace EXECUTING once, queue state WAITING_ACTION, and never
//     touch the step again — is entirely OWNED by transition.ts's activation code checking
//     `dispatches` before it ever schedules a `wake_at`; `begin()` here is consequently never
//     called in practice (due-wake only ever picks up rows that HAVE a wake_at). Kept as a
//     genuine (if unreachable) implementation rather than a throw, for interface completeness.
//   - `httpActionInvoker(client, dbLookup)`: `dispatches: true`, exposes `client` so loop.ts's
//     due-wake (polling/timeout) and monitor.ts's SSE fast path can share the SAME ActionClient
//     instance without EngineDeps growing a second, redundant "action client" field.
import { ActionInvokeFailed, ActionServerNotAllowed, type ActionClient, type Capabilities, type InvokeRequest } from './client.js';

export interface ActionInvocationContext {
  workCenterId: string;
  environmentOid: string;
  actionOid: string;
  workflowInstanceId: string;
  stepInstanceId: string;
  stepOid: string;
  inputParameters: Array<{ name: string; value: string }>;
  /** The ids the step itself declares (input_parameter_specifications). Loose matching requires
   *  only these of the container's action: `inputParameters` also carries every workflow
   *  starting parameter (the property store's fallback), which the step never declared and the
   *  action need not accept by name. Absent means "check every sent name" (pre-2026-10-28
   *  callers and tests). */
  declaredInputNames?: string[];
  timeoutMs?: number;
  matching: 'strict' | 'loose';
  // Always populated by loop.ts when the package can name them (env spec local_id ?? config
  // environment_name; roster action_name for the step's oid ?? config action_name); null only
  // when the package carries no name at all. Consumed by loose resolution — strict ignores them.
  environmentName: string | null;
  actionName: string | null;
  /** Spec 2026-08-21 (action-proxy name binding): the oid the work-center server-binding
   *  row is keyed by — the frozen recipe's (possibly name-resolved) embedded env spec oid.
   *  Absent means "same as environmentOid" (pre-name-binding callers and tests). */
  bindingEnvironmentOid?: string;
}

export type ActionBeginResult =
  | { ok: true; instanceId: string; serverUri: string; invokedActionOid: string }
  | { ok: false; error: string };

export interface ActionInvoker {
  /** Whether this invoker performs real dispatch. Gates whether ACTION PROXY activation
   *  (transition.ts) schedules a `wake_at` at all — false means the step parks at
   *  WAITING_ACTION and is never revisited (Task 9/10's original conformance-mode behavior). */
  readonly dispatches: boolean;
  /** The underlying REST client — non-null iff `dispatches` is true. loop.ts's due-wake
   *  (polling/timeout/best-effort abort) and monitor.ts (SSE fast path + best-effort delete)
   *  both read this rather than needing their own copy threaded through EngineDeps. */
  readonly client: ActionClient | null;
  /** GATE spec §7: the work-center environment-binding lookup, exposed so gate evaluation
   *  can resolve a server URI outside the invoke path. Null iff dispatches is false. */
  readonly bindingLookup: EnvironmentBindingLookup | null;
  begin(ctx: ActionInvocationContext): Promise<ActionBeginResult>;
}

/** Never invokes anything — the parking implementation used by the conformance harness and
 *  every test that doesn't exercise real action dispatch. See the header comment above for why
 *  `begin()` is unreachable in practice under this invoker. */
export const nullActionInvoker: ActionInvoker = {
  dispatches: false,
  client: null,
  bindingLookup: null,
  async begin(): Promise<ActionBeginResult> {
    return { ok: false, error: 'nullActionInvoker never dispatches (conformance/parking mode)' };
  },
};

/** Resolves the action server bound to a work center + environment — mission-control-db's
 *  `getEnvironmentBinding(db, workCenterId, environmentOid)` DAO function, threaded in as a
 *  plain function so this module never imports mission-control-db's dao tree directly (kept
 *  symmetrical with client.ts/sse.ts, which only ever take data, not DAOs). The oid passed is
 *  the BINDING key — `ctx.bindingEnvironmentOid ?? ctx.environmentOid`, i.e. the package's
 *  (possibly name-resolved) embedded env spec oid, not necessarily the step config's oid. */
export type EnvironmentBindingLookup = (workCenterId: string, bindingEnvironmentOid: string) => Promise<string | null>;

/** Real dispatch: resolve the environment's bound action-server URI, then invoke. Both steps
 *  happen OUTSIDE any db transaction — callers (loop.ts) commit whatever transaction read the
 *  step's config BEFORE calling this, and open a fresh one afterward to record the result. */
export function httpActionInvoker(client: ActionClient, dbLookup: EnvironmentBindingLookup): ActionInvoker {
  return {
    dispatches: true,
    client,
    bindingLookup: dbLookup,
    async begin(ctx: ActionInvocationContext): Promise<ActionBeginResult> {
      const bindingOid = ctx.bindingEnvironmentOid ?? ctx.environmentOid;
      const serverUri = await dbLookup(ctx.workCenterId, bindingOid);
      if (!serverUri) {
        return { ok: false, error: `No action server is bound for environment "${ctx.environmentName ?? bindingOid}" in this work center. Set it in Mission Commander under the work center's environment bindings.` };
      }
      let invokeActionOid = ctx.actionOid;
      let invokeEnvironmentOid = ctx.environmentOid;
      if (ctx.matching === 'loose') {
        const resolved = await resolveLoose(client, serverUri, ctx);
        if (!resolved.ok) return { ok: false, error: resolved.error };
        invokeActionOid = resolved.actionOid;
        invokeEnvironmentOid = resolved.environmentOid;
      }
      const body: InvokeRequest = {
        environment_oid: invokeEnvironmentOid,
        workflow_instance_id: ctx.workflowInstanceId,
        step_instance_id: ctx.stepInstanceId,
        step_oid: ctx.stepOid,
        input_parameters: ctx.inputParameters,
        timeout_ms: ctx.timeoutMs,
      };
      try {
        const { instanceId } = await client.invoke(serverUri, invokeActionOid, body);
        return { ok: true, instanceId, serverUri, invokedActionOid: invokeActionOid };
      } catch (err) {
        const envLabel = ctx.environmentName ?? ctx.environmentOid;
        if (err instanceof ActionServerNotAllowed) {
          return { ok: false, error: `${err.message} (environment "${envLabel}")` };
        }
        if (err instanceof ActionInvokeFailed && err.status === 404) {
          return { ok: false, error: `${serverUri} has no action "${ctx.actionName ?? ctx.actionOid}" for environment "${envLabel}". Check this environment's binding in this work center.` };
        }
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

type LooseResolution = { ok: true; actionOid: string; environmentOid: string } | { ok: false; error: string };

function resolveOnce(caps: Capabilities, envName: string, actionName: string, inputNames: string[]): LooseResolution {
  const envs = caps.environments.filter((e) => e.environmentName === envName);
  if (envs.length === 0) return { ok: false, error: `loose match: no environment named "${envName}" on the action server. Check this environment's binding in this work center.` };
  if (envs.length > 1) return { ok: false, error: `loose match: multiple environments named "${envName}" on the action server — ambiguous` };
  const actions = envs[0]!.actions.filter((a) => a.actionName === actionName);
  if (actions.length === 0) return { ok: false, error: `loose match: environment "${envName}" has no action named "${actionName}". Check this environment's binding in this work center.` };
  if (actions.length > 1) return { ok: false, error: `loose match: environment "${envName}" has multiple actions named "${actionName}" — ambiguous` };
  const have = new Set(actions[0]!.inputParameterNames);
  const missing = inputNames.filter((n) => !have.has(n));
  if (missing.length > 0) {
    return { ok: false, error: `loose match: action "${actionName}" is missing input parameter(s): ${missing.join(', ')}` };
  }
  return { ok: true, actionOid: actions[0]!.actionOid, environmentOid: envs[0]!.environmentOid };
}

/** Spec §5: on a resolution miss, bust the (possibly 5-min-stale) capabilities cache and
 *  retry ONCE so a just-corrected container is seen immediately. Fetch errors propagate to
 *  the caller's catch and fail the dispatch like any network failure. */
async function resolveLoose(client: ActionClient, serverUri: string, ctx: ActionInvocationContext): Promise<LooseResolution> {
  if (!ctx.environmentName || !ctx.actionName) {
    return { ok: false, error: `loose match: the workflow package carries no name for action oid "${ctx.actionOid}" (or environment oid "${ctx.environmentOid}") — cannot match by name` };
  }
  const inputNames = ctx.declaredInputNames ?? ctx.inputParameters.map((p) => p.name);
  try {
    const first = resolveOnce(await client.capabilities(serverUri), ctx.environmentName, ctx.actionName, inputNames);
    if (first.ok) return first;
    client.invalidateCapabilities(serverUri);
    const second = resolveOnce(await client.capabilities(serverUri), ctx.environmentName, ctx.actionName, inputNames);
    return second;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
