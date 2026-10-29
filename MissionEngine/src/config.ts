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

import type { ActionInvoker } from './actions/invoker.js';
import type { ResourcePropertySpecification } from './spec/types.js';

export interface EngineConfig {
  databaseUrl: string; port: number; workerConcurrency: number;
  actionServerAllowlist: string[]; scriptTimeoutMs: number; actionPollSecs: number; invokeGraceSecs: number;
  actionFetchTimeoutMs: number;
  /** Spec 2026-09-14 §4.5/§4.7: the REST-12 property-watch kill switch (PROPERTY_WATCH_ENABLED,
   *  default true — `false` starts nothing and the engine behaves exactly as before that spec)
   *  and its reconcile period (PROPERTY_WATCH_RECONCILE_MS, default 5000). */
  propertyWatchEnabled: boolean; propertyWatchReconcileMs: number;
  authSecret: string; baseUrl: string; internalToken: string | null;
  /** Mission Broker address + shared token: the token is sent to this origin only. */
  broker?: { url: string; token: string } | null;
  /** Mission Autopilot address + API key: the key is sent to this origin only. */
  actions?: { url: string; key: string } | null;
}

/** Everything the worker loop and its transitions need, threaded through explicitly so
 *  tests can fake the clock and swap the action invoker. `now` MUST be used for every time
 *  read inside the engine (timestamps, wake_at math) — never `new Date()`/`Date.now()`
 *  directly — so tests can pump the clock deterministically. */
export interface EngineDeps {
  config: EngineConfig;
  invoker: ActionInvoker;
  now: () => Date;
  /** Spec 2026-09-14 §4.7: called by loop.ts's runOnce after every cycle that did work (returned
   *  true), never on an idle cycle. index.ts hands the property watch's debounced `reconcileSoon`
   *  in here so loop.ts never imports the watcher. runOnce guards the call — a throw is logged,
   *  never propagated. Optional: tests and the conformance harness leave it unset. */
  onWorkDone?: () => void;
  /** Test-only injection seam: when set, called at the very top of runStepActivation with the
   *  step oid + its canonical step type, before any real per-step logic runs. Lets a test
   *  simulate an engine-internal throw (e.g. the C2 "poisoned instance" head-of-line-blocking
   *  scenario in linear-flow.test.ts) without depending on a permanently-unimplemented step
   *  type — Task 12 (WORKFLOW PROXY) closed the last such gap in the transition switch. Never
   *  set outside tests. */
  beforeStepActivation?: (stepOid: string, stepType: string) => void;
  /** Harness-only injection seam (Task 13's conformance harness): a fixture's
   *  `setup.initial_properties`, merged into the ROOT property store at instance start —
   *  transcribed ordering from the reference engine.ts constructor: initializeFromWorkflow
   *  (value-property defaults) -> initializeFromSetup (this field) -> initializeStartingParameters.
   *  Consumed once, by instance.ts's startInstanceFromQueued. Never set outside the harness. */
  harnessInitialProperties?: Record<string, string>;
  /** Harness-only injection seam (Task 13): a fixture's `setup.resources`, registered under
   *  `test:${name}` keys before the spec's own resource declarations — mirrors the reference
   *  runner's ad hoc InMemoryResourceManager setup (runner.ts:139-145). No vendored fixture
   *  currently exercises this path (grep-verified against all 82), but it's wired for parity.
   *  Never set outside the harness. */
  harnessSetupResources?: ResourcePropertySpecification[];
}

const DEV_AUTH_SECRET = 'insecure-dev-secret-change-me';

/** The compose dev default for ENGINE_INTERNAL_TOKEN. It is PUBLIC (it ships in the
 *  superproject's docker-compose.yml), so it may only gate /internal/* on a stack that
 *  is reachable from loopback alone — anywhere else it is no better than no token. */
const PUBLIC_DEV_INTERNAL_TOKEN = 'mission-internal-dev-token';

const SECRET_PLACEHOLDERS = new Set([DEV_AUTH_SECRET, 'change-me-in-production', PUBLIC_DEV_INTERNAL_TOKEN]);
const MIN_SECRET_LENGTH = 32;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** Loopback-only = the compose host bind (MISSION_ENGINE_BIND, when passed through) is
 *  loopback AND the advertised base URL points at loopback. A base URL that fails to
 *  parse counts as non-loopback — fail closed. */
function isLoopbackOnly(bind: string | undefined, baseUrl: string): boolean {
  if (bind && !LOOPBACK_HOSTS.has(bind)) return false;
  try {
    return LOOPBACK_HOSTS.has(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv): EngineConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const int = (v: string | undefined, dflt: number) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : dflt; };
  // `''` counts as unset — compose's `${VAR:-true}` passthrough yields it when the shell var is empty.
  const bool = (v: string | undefined, dflt: boolean) => {
    if (v === undefined || v.trim() === '') return dflt;
    return !['false', '0', 'no', 'off'].includes(v.trim().toLowerCase());
  };
  const port = int(env.ENGINE_PORT, 3006);
  // `||` (not `??`) so a defined-but-empty BETTER_AUTH_SECRET — what compose's
  // `${BETTER_AUTH_SECRET:-}` passthrough style yields when the shell var is unset — still
  // lands on the dev fallback instead of being accepted as a "real" empty secret.
  const production = env.NODE_ENV === 'production';
  const rawSecret = (env.BETTER_AUTH_SECRET ?? '').trim();
  if (production && (SECRET_PLACEHOLDERS.has(rawSecret) || rawSecret.length < MIN_SECRET_LENGTH)) {
    throw new Error('BETTER_AUTH_SECRET (MISSION_ENGINE_AUTH_SECRET in .env) is missing, a placeholder, or shorter than 32 characters. Run scripts/setup-secrets.sh, then recreate the engine.');
  }
  const authSecret = rawSecret || DEV_AUTH_SECRET;
  if (authSecret === DEV_AUTH_SECRET && !process.env.VITEST) {
    console.warn('BETTER_AUTH_SECRET is unset — falling back to the insecure dev secret. Set BETTER_AUTH_SECRET before running against real data.');
  }
  const baseUrl = (env.ENGINE_BASE_URL && env.ENGINE_BASE_URL !== '/') ? env.ENGINE_BASE_URL : `http://127.0.0.1:${port}`;
  if (production && (env.ENGINE_INTERNAL_TOKEN ?? '').trim() === PUBLIC_DEV_INTERNAL_TOKEN) {
    throw new Error('ENGINE_INTERNAL_TOKEN is the public dev default. Run scripts/setup-secrets.sh, then recreate the engine.');
  }
  let internalToken = env.ENGINE_INTERNAL_TOKEN || null;
  if (!internalToken && !process.env.VITEST) {
    console.warn('ENGINE_INTERNAL_TOKEN is unset — the internal control API is disabled (every /internal/* request 401s). Set it to enable CM runtime controls.');
  }
  if (internalToken === PUBLIC_DEV_INTERNAL_TOKEN && !isLoopbackOnly(env.MISSION_ENGINE_BIND, baseUrl)) {
    internalToken = null;
    if (!process.env.VITEST) {
      console.error('ENGINE_INTERNAL_TOKEN is the public compose dev default but the engine is reachable beyond loopback — refusing it. The internal control API is disabled (every /internal/* request 401s) until a real ENGINE_INTERNAL_TOKEN is set.');
    }
  }
  const brokerUrl = (env.MISSION_BROKER_URL ?? '').trim();
  const brokerToken = (env.MISSION_BROKER_TOKEN ?? '').trim();
  if (brokerUrl) {
    let ok = false;
    try { const p = new URL(brokerUrl).protocol; ok = p === 'http:' || p === 'https:'; } catch { /* not a URL */ }
    if (!ok) throw new Error('MISSION_BROKER_URL must be an http(s) URL');
  }
  if (brokerToken && !brokerUrl && !process.env.VITEST) {
    console.warn('MISSION_BROKER_TOKEN is set but MISSION_BROKER_URL is not — the engine sends the token to no action server, so the Mission Broker will refuse its calls. Set MISSION_BROKER_URL (e.g. http://mission-broker:3007).');
  }
  if (brokerUrl && !brokerToken && !process.env.VITEST) {
    console.warn("MISSION_BROKER_URL is set but MISSION_BROKER_TOKEN is not — the Mission Broker will refuse the engine's calls.");
  }
  const actionsUrl = (env.MISSION_ACTIONS_URL ?? '').trim();
  const actionsKey = (env.ACTIONS_API_KEY ?? '').trim();
  if (actionsUrl) {
    let ok = false;
    try { const p = new URL(actionsUrl).protocol; ok = p === 'http:' || p === 'https:'; } catch { /* not a URL */ }
    if (!ok) throw new Error('MISSION_ACTIONS_URL must be an http(s) URL');
  }
  if (actionsKey && !actionsUrl && !process.env.VITEST) {
    console.warn('ACTIONS_API_KEY is set but MISSION_ACTIONS_URL is not — the engine sends the key to no action server, so Mission Autopilot will refuse its calls. Set MISSION_ACTIONS_URL (e.g. http://mission-autopilot-server:3002).');
  }
  if (actionsUrl && !actionsKey && !process.env.VITEST) {
    console.warn("MISSION_ACTIONS_URL is set but ACTIONS_API_KEY is not — Mission Autopilot will refuse the engine's calls.");
  }
  return {
    databaseUrl,
    port,
    workerConcurrency: int(env.ENGINE_WORKER_CONCURRENCY, 4),
    actionServerAllowlist: (env.ACTION_SERVER_ALLOWLIST ?? '').split(',').map(s => s.trim()).filter(Boolean),
    scriptTimeoutMs: int(env.SCRIPT_TIMEOUT_MS, 5000),
    actionPollSecs: int(env.ACTION_POLL_SECS, 20),
    invokeGraceSecs: int(env.INVOKE_GRACE_SECS, 60),
    actionFetchTimeoutMs: int(env.ACTION_FETCH_TIMEOUT_MS, 10_000),
    propertyWatchEnabled: bool(env.PROPERTY_WATCH_ENABLED, true),
    propertyWatchReconcileMs: int(env.PROPERTY_WATCH_RECONCILE_MS, 5000),
    authSecret,
    baseUrl,
    internalToken,
    broker: brokerUrl && brokerToken ? { url: brokerUrl, token: brokerToken } : null,
    actions: actionsUrl && actionsKey ? { url: actionsUrl, key: actionsKey } : null,
  };
}
