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
// REST client for the Trajectory action-server protocol (spec/docs/RESTProtocolSpec.md in
// TrajectoryRuntime). Semantics ported from the reference repo's
// engines/web-ui/src/actionProxy/ActionApiClient.ts + its types.ts, simplified per
// task-14-brief.md:
//   - ActionSnapshot drops everything but { state, outputs } — Task 15 doesn't need the rest.
//   - capabilities() now keeps the reference's environment-grouped shape (task-3-brief.md,
//     action-matching-mode) instead of collapsing it: `environments` lets loose-matching walk
//     actions grouped by environment, while `byActionOid` stays as the flat lookup existing
//     consumers (commandSupported) rely on. This FIXES a latent bug — the previous flat
//     `data.actions` parse never matched the real MissionActions server's actual response shape
//     (`data.environments[].actions[]`), so every real-server capabilities() call silently
//     produced an empty map and every command was read as unsupported.
//   - Errors: invoke's non-201 and getInstance's non-404-non-200 throw a plain Error carrying
//     the status + body text (no rich ApiError class); only getInstance's 404 gets the typed
//     ActionInstanceLost. sendCommand's 409 is tolerated (resolves) — commands are best-effort.
//     deleteInstance is entirely best-effort and swallows any error.
//   - Allowlist gating is exact-origin match (new URL(serverUri).origin) — no wildcard, no
//     prefix matching. An empty allowlist always throws ActionServerNotAllowed.
// This file only introduces new surface — no engine-core changes. Task 15 wires it into step
// execution (invoke/monitor/terminals/timeout) and imports the two error classes below.
//
// Spec 2026-09-05 (action-server-trust task 2): the allowlist and trust mode no longer live in
// a static boot-time array — they live in system_settings (mission-control-db's DAO) and are
// read through a 5-second cache (policy-cache.ts), so a Mission Commander change to either takes
// effect within a few seconds, with no engine restart. Under LOOSE trust every http(s) origin is allowed
// (a console.warn fires once per origin per process — never per call); STRICT keeps the exact-
// origin allowlist check unchanged. Tests and production callers that still want a fixed list
// pass a plain `string[]` (wrapped by `staticPolicy`, strict by default).

import type { ActionServerPolicy, ActionServerTrust } from 'mission-control-db/src/dao/system-settings';
import {
  subscribeEventStream, subscribeSse, toPropertyEvent,
  type ActionEvent, type EventStreamCallbacks, type PropertyStreamEvent, type SseHandle,
} from './sse.js';

export type ServerState =
  | 'IDLE' | 'RUNNING' | 'PAUSED' | 'HELD'
  | 'COMPLETED' | 'ABORTED' | 'STOPPED' | 'ERRORED';

export type ActionCommand = 'PAUSE' | 'RESUME' | 'HOLD' | 'UNHOLD' | 'ABORT' | 'STOP' | 'CLEAR';

export type Visibility = 'opaque' | 'observable';

export type FetchLike = typeof fetch;

/** Wire request body for invoke — field names transcribed from the reference InvokeRequest
 *  (engines/web-ui/src/actionProxy/types.ts), which mirror MasterWorkflowStep's
 *  ActionProxyConfig (action_oid/environment_oid/timeout_ms) already in spec/types.ts. */
export interface InvokeRequest {
  environment_oid: string;
  workflow_instance_id: string;
  step_instance_id: string;
  step_oid: string;
  input_parameters: Array<{ name: string; value: string }>;
  timeout_ms?: number;
}

/** Simplified per task-14-brief.md: just enough for Task 15 to drive execution. */
export interface ActionSnapshot {
  state: ServerState;
  outputs: Array<{ name: string; value: string }>;
}

export interface ActionCapability {
  supportedCommands: string[];
  opaque: boolean;
}

interface CapabilitiesWireResponse {
  data: {
    environments: Array<{
      environment_oid: string;
      environment_name: string;
      actions: Array<{
        action_oid: string; action_name: string; visibility: Visibility;
        input_parameters: Array<{ name: string }>;
        supported_commands: string[];
      }>;
    }>;
  };
}

export interface CapabilityAction {
  actionOid: string;
  actionName: string;
  inputParameterNames: string[];
  capability: ActionCapability;
}

export interface CapabilityEnvironment {
  environmentOid: string;
  environmentName: string;
  actions: CapabilityAction[];
}

export interface Capabilities {
  byActionOid: Map<string, ActionCapability>;
  environments: CapabilityEnvironment[];
}

const CAPABILITIES_TTL_MS = 5 * 60 * 1000;

/** Spec 2026-09-05: the allowlist and trust mode live in system_settings and are read through a
 *  5-second cache (policy-cache.ts) so a Mission Commander change applies within a few seconds. Tests and
 *  `makeHttpDeps` keep passing a plain string[] — wrapped by staticPolicy (strict). */
export type ActionServerPolicySource = () => Promise<ActionServerPolicy>;
export function staticPolicy(allowlist: string[], trust: ActionServerTrust = 'strict'): ActionServerPolicySource {
  const policy: ActionServerPolicy = { trust, allowlist: [...allowlist] };
  return async () => policy;
}

/** The action server answered an invoke with a non-201 status. */
export class ActionInvokeFailed extends Error {
  constructor(readonly status: number, readonly body: string) {
    super(`action invoke failed (${status}): ${body}`);
    this.name = 'ActionInvokeFailed';
  }
}

/** The Mission Broker answered 401 'missing or wrong broker token'. */
export const BROKER_TOKEN_REJECTED_MESSAGE = "Mission Broker refused the call: the engine's MISSION_BROKER_TOKEN does not match the broker's, or this environment's binding does not use the MISSION_BROKER_URL address. Set the same token for both in .env, check the binding, and restart them.";
export class BrokerTokenRejected extends Error {
  constructor() {
    super(BROKER_TOKEN_REJECTED_MESSAGE);
    this.name = 'BrokerTokenRejected';
  }
}

/** Mission Autopilot answered 401: the engine's ACTIONS_API_KEY is wrong or missing. */
export const ACTIONS_KEY_REJECTED_MESSAGE = "Mission Autopilot refused the call: the engine's ACTIONS_API_KEY does not match the server's, or this environment's binding does not use the MISSION_ACTIONS_URL address. Set the same ACTIONS_API_KEY for both in .env, check the binding, and restart them.";
export class ActionsKeyRejected extends Error {
  constructor() {
    super(ACTIONS_KEY_REJECTED_MESSAGE);
    this.name = 'ActionsKeyRejected';
  }
}

/** serverUri failed the allowlist check — thrown before any fetch happens. */
export class ActionServerNotAllowed extends Error {
  constructor(serverUri: string) {
    super(`Action server is not in the allowlist: "${serverUri}". Add its origin under Mission Commander → Settings → Action server trust, or switch the trust mode to Loose.`);
    this.name = 'ActionServerNotAllowed';
  }
}

/** getInstance's 404 — the action server no longer knows this instance (restarted, expired,
 *  never existed). Distinct from a generic Error so Task 15 can decide to treat the step as
 *  failed/orphaned rather than retrying forever. */
export class ActionInstanceLost extends Error {
  constructor(instanceId: string) {
    super(`Action instance not found on server: "${instanceId}"`);
    this.name = 'ActionInstanceLost';
  }
}

/** sendCommand's answer was neither 200 nor 409 (data safety round 3, spec 2026-10-22-data-safety-3
 *  §1): the status lets a caller tell an unknown instance (404) from a refusal (other 4xx) or an
 *  unreachable server (5xx) without reading the message text. */
export class ActionCommandFailed extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ActionCommandFailed';
  }
}

/** getInstance's answer was neither 200 nor 404 (round 2, spec 2026-10-23 goal 5): the status
 *  lets the poll path name it in its warning (`HTTP 401`) without reading the message text. */
export class ActionStatusFailed extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ActionStatusFailed';
  }
}

interface CapabilityCacheEntry {
  expiresAt: number;
  data: Capabilities;
}

/** GATE follow-up item 2 (2026-09-04): the default bound on every action-server round trip.
 *  Ten seconds is generous for a LAN action server and short enough that a wedged one costs
 *  the single sequential worker one bounded wait, not a hang. */
export const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

export class ActionClient {
  private readonly policy: ActionServerPolicySource;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly capabilityCache = new Map<string, CapabilityCacheEntry>();
  private readonly looseWarned = new Set<string>();

  private readonly broker: { origin: string; token: string } | null;
  private readonly actions: { origin: string; key: string } | null;

  constructor(policy: ActionServerPolicySource | string[], fetchImpl: FetchLike = fetch, opts: { timeoutMs?: number; broker?: { url: string; token: string } | null; actions?: { url: string; key: string } | null } = {}) {
    let broker: { origin: string; token: string } | null = null;
    if (opts.broker) {
      try { broker = { origin: new URL(opts.broker.url).origin, token: opts.broker.token }; } catch { broker = null; }
    }
    this.broker = broker;
    let actions: { origin: string; key: string } | null = null;
    if (opts.actions) {
      try { actions = { origin: new URL(opts.actions.url).origin, key: opts.actions.key }; } catch { actions = null; }
    }
    this.actions = actions;
    this.policy = Array.isArray(policy) ? staticPolicy(policy) : policy;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  }

  /** Every call is bounded: a bound GATE polls getProperty once per cycle on the engine's
   *  single sequential worker, so an unbounded fetch against a wedged action server would
   *  stall gate evaluation and due-action work engine-wide. `AbortSignal.timeout` rejects the
   *  fetch with a DOMException named "TimeoutError"; callers see it as any other network
   *  failure (deleteInstance swallows it, the rest propagate). */
  private fetchBounded(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = { ...(init.headers as Record<string, string> | undefined), ...this.credentialHeaders(url) };
    return this.fetchImpl(url, { ...init, headers, signal: AbortSignal.timeout(this.timeoutMs) });
  }

  /** Each credential goes to its own origin only — the broker token to the broker, the
   *  Mission Autopilot key to Mission Autopilot — never to any other action server. */
  private credentialHeaders(url: string): Record<string, string> {
    try {
      const origin = new URL(url).origin;
      if (this.broker && origin === this.broker.origin) return { Authorization: `Bearer ${this.broker.token}` };
      if (this.actions && origin === this.actions.origin) return { 'X-API-Key': this.actions.key };
    } catch { /* bad url: no credentials */ }
    return {};
  }

  /** On a 401, read the body once: the broker's refusal becomes BrokerTokenRejected, any 401
   *  from the Mission Autopilot origin becomes ActionsKeyRejected; other text is returned for
   *  the caller's ordinary error. */
  private async bodyOrRefusal(resp: Response, url: string): Promise<string> {
    const text = await resp.text();
    if (resp.status === 401) {
      if (text.includes('missing or wrong broker token')) throw new BrokerTokenRejected();
      try {
        if (this.actions && new URL(url).origin === this.actions.origin) throw new ActionsKeyRejected();
      } catch (e) {
        if (e instanceof ActionsKeyRejected) throw e;
      }
    }
    return text;
  }

  /** Public: the SSE monitor asks the same question the fetch path asks. */
  async isAllowed(serverUri: string): Promise<boolean> {
    let url: URL;
    try {
      url = new URL(serverUri);
    } catch {
      return false;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const { trust, allowlist } = await this.policy();
    if (trust === 'loose') {
      if (!this.looseWarned.has(url.origin)) {
        this.looseWarned.add(url.origin);
        console.warn(`[mission-engine] action-server trust is LOOSE: contacting ${url.origin} without an allowlist check`);
      }
      return true;
    }
    return allowlist.includes(url.origin);
  }

  private async assertAllowed(serverUri: string): Promise<void> {
    if (!(await this.isAllowed(serverUri))) throw new ActionServerNotAllowed(serverUri);
  }

  async invoke(serverUri: string, actionOid: string, body: InvokeRequest): Promise<{ instanceId: string }> {
    await this.assertAllowed(serverUri);
    const resp = await this.fetchBounded(`${serverUri}/trajectory/v1/actions/${encodeURIComponent(actionOid)}/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (resp.status !== 201) {
      throw new ActionInvokeFailed(resp.status, await this.bodyOrRefusal(resp, serverUri));
    }
    const json = (await resp.json()) as { data: { instance_id: string } };
    return { instanceId: json.data.instance_id };
  }

  async getInstance(serverUri: string, instanceId: string): Promise<ActionSnapshot> {
    await this.assertAllowed(serverUri);
    const resp = await this.fetchBounded(`${serverUri}/trajectory/v1/instances/${encodeURIComponent(instanceId)}`);
    if (resp.status === 404) throw new ActionInstanceLost(instanceId);
    if (resp.status !== 200) {
      throw new ActionStatusFailed(resp.status, `action getInstance failed (${resp.status}): ${await this.bodyOrRefusal(resp, serverUri)}`);
    }
    const json = (await resp.json()) as { data: ActionSnapshot };
    return json.data;
  }

  async sendCommand(serverUri: string, instanceId: string, command: ActionCommand): Promise<void> {
    await this.assertAllowed(serverUri);
    const resp = await this.fetchBounded(`${serverUri}/trajectory/v1/instances/${encodeURIComponent(instanceId)}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    });
    // Commands are best-effort: a 409 (invalid transition — the instance already moved on,
    // e.g. it completed before the PAUSE arrived) is not actionable by the caller.
    if (resp.status === 200 || resp.status === 409) return;
    throw new ActionCommandFailed(resp.status, `action command failed (${resp.status}): ${await this.bodyOrRefusal(resp, serverUri)}`);
  }

  async deleteInstance(serverUri: string, instanceId: string): Promise<void> {
    await this.assertAllowed(serverUri);
    try {
      await this.fetchBounded(`${serverUri}/trajectory/v1/instances/${encodeURIComponent(instanceId)}`, { method: 'DELETE' });
    } catch {
      // Best-effort cleanup — a failed delete (network error, server already gone, instance
      // already reaped) is never actionable by the caller.
    }
  }

  async capabilities(serverUri: string): Promise<Capabilities> {
    await this.assertAllowed(serverUri);
    const origin = new URL(serverUri).origin;
    const now = Date.now();
    const cached = this.capabilityCache.get(origin);
    if (cached && cached.expiresAt > now) return cached.data;

    const resp = await this.fetchBounded(`${serverUri}/trajectory/v1/capabilities`);
    if (resp.status !== 200) {
      throw new Error(`action capabilities failed (${resp.status}): ${await this.bodyOrRefusal(resp, serverUri)}`);
    }
    const json = (await resp.json()) as CapabilitiesWireResponse;
    const byActionOid = new Map<string, ActionCapability>();
    const environments: CapabilityEnvironment[] = json.data.environments.map((env) => ({
      environmentOid: env.environment_oid,
      environmentName: env.environment_name,
      actions: env.actions.map((a) => {
        const capability: ActionCapability = {
          supportedCommands: a.supported_commands, opaque: a.visibility === 'opaque',
        };
        byActionOid.set(a.action_oid, capability);
        return {
          actionOid: a.action_oid, actionName: a.action_name,
          inputParameterNames: a.input_parameters.map((p) => p.name), capability,
        };
      }),
    }));
    const data: Capabilities = { byActionOid, environments };
    this.capabilityCache.set(origin, { expiresAt: now + CAPABILITIES_TTL_MS, data });
    return data;
  }

  /** Data-safety spec 2026-10-21: the cached capabilities for `serverUri`'s origin, even past
   *  their TTL, or undefined. Never fetches and never reads the policy — the one ActionClient
   *  call that is safe inside a locked transaction. */
  peekCapabilities(serverUri: string): Capabilities | undefined {
    try { return this.capabilityCache.get(new URL(serverUri).origin)?.data; } catch { return undefined; }
  }

  /** True when `serverUri`'s origin has a cache entry still inside its TTL — capabilities()
   *  would answer it without a fetch. Cache-only, like peekCapabilities. */
  hasFreshCapabilities(serverUri: string): boolean {
    try {
      const cached = this.capabilityCache.get(new URL(serverUri).origin);
      return cached !== undefined && cached.expiresAt > Date.now();
    } catch {
      return false;
    }
  }

  invalidateCapabilities(serverUri: string): void {
    try { this.capabilityCache.delete(new URL(serverUri).origin); } catch { /* bad uri: nothing cached */ }
  }

  /** GATE spec 2026-08-29 §7: read one env-level property group's CURRENT values from the
   *  action server (REST-11). `environment_oid` is always sent — it disambiguates same-named
   *  groups across environments (the server 409s an ambiguous unfiltered read). */
  async getProperty(serverUri: string, propertyName: string, environmentOid: string): Promise<{
    environmentOid: string; name: string; entries: Array<{ name: string; value: string }>;
  }> {
    await this.assertAllowed(serverUri);
    const resp = await this.fetchBounded(
      `${serverUri}/trajectory/v1/properties/${encodeURIComponent(propertyName)}?environment_oid=${encodeURIComponent(environmentOid)}`,
    );
    if (resp.status !== 200) {
      throw new Error(`action property read failed (${resp.status}): ${await this.bodyOrRefusal(resp, serverUri)}`);
    }
    const json = (await resp.json()) as {
      data: { environment_oid: string; name: string; entries?: Array<{ name: string; value: string }> };
    };
    return {
      environmentOid: json.data.environment_oid,
      name: json.data.name,
      entries: json.data.entries ?? [],
    };
  }

  /** Spec 2026-09-14 §4.6: the action-instance event stream (RESTProtocolSpec.md §2.6), gated
   *  by the same allowlist check as every fetch and opened with the client's own `fetchImpl` —
   *  one path for both event streams. Rejects with ActionServerNotAllowed before any fetch when
   *  the origin is not trusted. Raw `fetchImpl`, never `fetchBounded`: a stream lives for the
   *  life of the action and `AbortSignal.timeout` would kill it. */
  async subscribeInstanceEvents(serverUri: string, instanceId: string, onEvent: (e: ActionEvent) => void): Promise<SseHandle> {
    await this.assertAllowed(serverUri);
    return subscribeSse(serverUri, instanceId, onEvent, this.fetchImpl, this.credentialHeaders(serverUri));
  }

  /** Spec 2026-09-14 §4.6: REST-12 — one environment-scoped property group's event stream
   *  (`GET /trajectory/v1/properties/{group}/events?environment_oid=`). `environment_oid` is
   *  always sent: same-named groups across environments 409 unfiltered, exactly as REST-11.
   *  Same allowlist gate and same raw-`fetchImpl` rule as subscribeInstanceEvents — the stream
   *  is meant to live for hours. Reconnect is the caller's job (core/property-watch.ts), driven
   *  by `callbacks.onEnd`. */
  async subscribePropertyEvents(
    serverUri: string, group: string, environmentOid: string,
    callbacks: EventStreamCallbacks<PropertyStreamEvent>,
  ): Promise<SseHandle> {
    await this.assertAllowed(serverUri);
    const url = `${serverUri}/trajectory/v1/properties/${encodeURIComponent(group)}/events?environment_oid=${encodeURIComponent(environmentOid)}`;
    return subscribeEventStream(url, toPropertyEvent, callbacks, this.fetchImpl, this.credentialHeaders(serverUri));
  }
}
