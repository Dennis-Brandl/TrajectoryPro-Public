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
// GATE bound-property events (spec 2026-09-14): the REST-12 property-watch registry. A bound
// GATE re-evaluates once per cycle (core/gate.ts's processDueGateWork); this module subscribes
// to Mission Autopilot's per-group event stream and, on a `property` event, pulls every waiting
// member gate's (or repeating script's, spec 2026-10-13 §6.2) wake_at to NOW and wakes the loop. The event is a TRIGGER, never a value (§1,
// §3): the claim path then fetches over REST-11 and evaluates exactly as before. The database is
// the only source of truth (§4.4): reconcile() rebuilds the wanted key set from WAITING_GATE / WAITING_SCRIPT
// rows and diffs it against the open streams; nothing is persisted. Every failure is engine-log
// only (§2 ruling 2) — the cycle is the heartbeat and the fallback.
import { and, eq, gt, inArray, isNotNull } from 'drizzle-orm';
import { workflowInstance, stepInstance } from 'mission-control-db/src/db/schema/index';
import type { Db } from '../db.js';
import type { EngineDeps } from '../config.js';
import type { ActionClient } from '../actions/client.js';
import type { EventStreamCallbacks, PropertyStreamEvent, SseHandle } from '../actions/sse.js';
import type { MasterWorkflowSpecification } from '../spec/types.js';
import { findEnvSpec, findEnvSpecsByName, findStepDef } from '../loop.js';
import { canonicalStepType } from './step-handlers.js';

// ── Data layer (§4.2, §4.3, §4.4) ──

/** §4.1: one subscription key — `serverUri | environmentOid | group`. */
export interface PropertyWatchKey {
  key: string;
  serverUri: string;
  environmentOid: string;
  group: string;
}

/** One WAITING_GATE / WAITING_SCRIPT row as reconcile reads it (joined to its workflow_instance). */
export interface WatchedGateRow {
  stepInstanceId: string;
  stepOid: string;
  nodeOid: string;
  workCenterId: string;
  spec: MasterWorkflowSpecification;
}

export interface KeyResolutionDeps {
  bindingLookup: (workCenterId: string, environmentOid: string) => Promise<string | null>;
  isAllowed: (serverUri: string) => Promise<boolean>;
}

export interface ResolvedKeys {
  keys: PropertyWatchKey[];
  skipped: Array<{ stepInstanceId: string; reason: string }>;
}

export function watchKey(serverUri: string, environmentOid: string, group: string): string {
  return `${serverUri}|${environmentOid}|${group}`;
}

/** §4.2 step 1: REST-12 is keyed by group — the part before the first `.` of a dotted binding. */
export function groupOf(property: string): string {
  const dot = property.indexOf('.');
  return dot === -1 ? property : property.slice(0, dot);
}

/** §4.2: the keys one waiting gate needs, mirroring core/property-overlay.ts's resolution step
 *  for step (oid-then-unique-name environment against the frozen recipe, then the work-center
 *  binding, then trust). A binding that fails any step is reported in `skipped` (the registry
 *  logs it once per gate and reason) and the remaining bindings are still resolved. Two
 *  bindings on one group yield one key; two groups yield two. */
export async function resolveGateKeys(row: WatchedGateRow, deps: KeyResolutionDeps): Promise<ResolvedKeys> {
  const keys = new Map<string, PropertyWatchKey>();
  const skipped: ResolvedKeys['skipped'] = [];
  const stepDef = findStepDef(row.spec, row.nodeOid, row.stepOid);
  // A gate reads gate_config's bindings; a repeating SCRIPT its step-level ones (§6.2).
  const bindings = stepDef && canonicalStepType(stepDef.step_type) === 'GATE'
    ? stepDef.gate_config?.action_property_bindings ?? []
    : stepDef?.action_property_bindings ?? [];
  for (const b of bindings) {
    let envSpec = b.environment_oid ? findEnvSpec(row.spec, row.nodeOid, b.environment_oid) : undefined;
    if (!envSpec && b.environment_name) {
      const byName = findEnvSpecsByName(row.spec, row.nodeOid, b.environment_name);
      if (byName.length === 1) envSpec = byName[0];
    }
    const environmentOid = envSpec?.oid ?? b.environment_oid;
    if (!environmentOid) {
      skipped.push({ stepInstanceId: row.stepInstanceId, reason: `binding '${b.parameter_id}': no resolvable environment` });
      continue;
    }
    const serverUri = await deps.bindingLookup(row.workCenterId, environmentOid);
    if (!serverUri) {
      skipped.push({ stepInstanceId: row.stepInstanceId, reason: `binding '${b.parameter_id}': no action server bound for environment ${environmentOid}` });
      continue;
    }
    if (!(await deps.isAllowed(serverUri))) {
      skipped.push({ stepInstanceId: row.stepInstanceId, reason: `binding '${b.parameter_id}': action server ${serverUri} is not allowed by the current trust policy` });
      continue;
    }
    const group = groupOf(b.property);
    const key = watchKey(serverUri, environmentOid, group);
    if (!keys.has(key)) keys.set(key, { key, serverUri, environmentOid, group });
  }
  return { keys: [...keys.values()], skipped };
}

/** §4.4: every WAITING_GATE gate row with a live timer, joined to its instance. Instance status
 *  is deliberately not filtered (a paused instance's gate keeps its subscription — the claim path
 *  already refuses anything but `running`). Rows whose wake_at is NULL (an open armed gate,
 *  nulled by evaluateGateOnClaim's TRUE branch) are excluded because §3 forbids ever touching
 *  them, so a stream for them could never do anything. WAITING_SCRIPT rows (a repeating script
 *  with bindings) are watched the same way; a row without bindings resolves to no keys. */
export async function loadWaitingGates(db: Db): Promise<WatchedGateRow[]> {
  const rows = await db.select({
    stepInstanceId: stepInstance.id, stepOid: stepInstance.stepOid, nodeOid: stepInstance.nodeOid,
    workCenterId: workflowInstance.workCenterId, specJsonb: workflowInstance.specJsonb,
  }).from(stepInstance)
    .innerJoin(workflowInstance, eq(stepInstance.workflowInstanceId, workflowInstance.id))
    .where(and(
      inArray(stepInstance.state, ['WAITING_GATE', 'WAITING_SCRIPT']), isNotNull(stepInstance.wakeAt),
    ))
    .orderBy(stepInstance.id);
  return rows.map((r) => ({
    stepInstanceId: r.stepInstanceId, stepOid: r.stepOid, nodeOid: r.nodeOid, workCenterId: r.workCenterId,
    spec: r.specJsonb as MasterWorkflowSpecification,
  }));
}

/** §4.3: an event only moves an existing due time EARLIER. One statement, no instance lock:
 *  wake_at on a waiting gate is the gate unit's own field and the claim path re-reads it. Rows
 *  that left WAITING_GATE, rows whose wake_at is NULL (open armed gates) and rows already due are
 *  never touched — so a burst of events collapses to one evaluation. Returns the number of rows
 *  pulled forward, so the caller wakes the loop only when something changed. */
export async function markGatesDue(db: Db, now: Date, stepInstanceIds: string[]): Promise<number> {
  if (stepInstanceIds.length === 0) return 0;
  const rows = await db.update(stepInstance).set({ wakeAt: now, updatedAt: now }).where(and(
    inArray(stepInstance.id, stepInstanceIds),
    inArray(stepInstance.state, ['WAITING_GATE', 'WAITING_SCRIPT']),
    isNotNull(stepInstance.wakeAt),
    gt(stepInstance.wakeAt, now),
  )).returning({ id: stepInstance.id });
  return rows.length;
}

// ── Registry (§4.1, §4.4, §4.5) ──

export const PROPERTY_WATCH_DEBOUNCE_MS = 500;
export const PROPERTY_WATCH_BACKOFF_BASE_MS = 5000;
export const PROPERTY_WATCH_BACKOFF_MAX_MS = 60_000;

/** Everything the registry touches outside itself, injected so it can be tested with a fake
 *  subscriber and fake timers and no HTTP at all (startPropertyWatch wires the real ports). */
export interface PropertyWatchIo {
  loadGates(): Promise<WatchedGateRow[]>;
  resolve(row: WatchedGateRow): Promise<ResolvedKeys>;
  subscribe(key: PropertyWatchKey, callbacks: EventStreamCallbacks<PropertyStreamEvent>): Promise<SseHandle>;
  /** Pull these gates' wake_at to now; returns how many rows moved. */
  markDue(stepInstanceIds: string[]): Promise<number>;
  wake(): void;
}

export interface PropertyWatchOptions {
  reconcileMs: number;
  /** Backoff = min(base · 2^attempt, max). Defaults are the spec's 5000 / 60000; tests shrink them. */
  backoffBaseMs?: number;
  backoffMaxMs?: number;
}

export interface PropertyWatchSnapshotEntry {
  key: string;
  members: string[];
  live: boolean;
  attempt: number;
  lastReason: string | null;
}

export interface PropertyWatchHandle {
  /** §4.4: debounced — at most one reconcile per PROPERTY_WATCH_DEBOUNCE_MS. The loop calls this
   *  after every unit of work (EngineDeps.onWorkDone). */
  reconcileSoon(): void;
  /** One reconcile, awaited (startup, and tests). A run already in flight is followed by exactly
   *  one more, and every caller's promise resolves after that follow-up. */
  reconcileNow(): Promise<void>;
  /** Close every stream, cancel every timer and pending retry. Idempotent. */
  stop(): void;
  /** Read-only view of the registry, for tests and diagnostics (the monitor.ts
   *  `hasActiveSubscription` precedent). Members are sorted. */
  snapshot(): PropertyWatchSnapshotEntry[];
}

interface WatchEntry extends PropertyWatchKey {
  members: Set<string>;
  stream: SseHandle | null;
  live: boolean;
  attempt: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  lastReason: string | null;
  closed: boolean;
}

export function createPropertyWatch(io: PropertyWatchIo, opts: PropertyWatchOptions): PropertyWatchHandle {
  const backoffBase = opts.backoffBaseMs ?? PROPERTY_WATCH_BACKOFF_BASE_MS;
  const backoffMax = opts.backoffMaxMs ?? PROPERTY_WATCH_BACKOFF_MAX_MS;
  const entries = new Map<string, WatchEntry>();
  /** `${stepInstanceId}\u0000${reason}` tags already logged — pruned to live rows each reconcile. */
  const loggedSkips = new Set<string>();
  let lastReconcileError: string | null = null;
  let stopped = false;
  let running: Promise<void> | null = null;
  let rerun = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** §4.4: the database is the only source of truth — rebuild the wanted set, then diff. */
  async function reconcileOnce(): Promise<void> {
    const rows = await io.loadGates();
    const wanted = new Map<string, { key: PropertyWatchKey; members: Set<string> }>();
    const liveSkips = new Set<string>();
    for (const row of rows) {
      let resolved: ResolvedKeys;
      try {
        resolved = await io.resolve(row);
      } catch (err) {
        // One gate's lookup failing (a DAO error for its work center) must not silence the watch for
        // every other gate: treat it as a skip — logged once per (gate, reason) like any other.
        resolved = { keys: [], skipped: [{ stepInstanceId: row.stepInstanceId, reason: `resolution failed: ${err instanceof Error ? err.message : String(err)}` }] };
      }
      const { keys, skipped } = resolved;
      for (const s of skipped) {
        const tag = `${s.stepInstanceId}\u0000${s.reason}`;
        liveSkips.add(tag);
        if (!loggedSkips.has(tag)) {
          loggedSkips.add(tag);
          console.warn(`[mission-engine] property watch: gate step ${s.stepInstanceId} not watched — ${s.reason}`);
        }
      }
      for (const k of keys) {
        const w = wanted.get(k.key) ?? { key: k, members: new Set<string>() };
        w.members.add(row.stepInstanceId);
        wanted.set(k.key, w);
      }
    }
    for (const tag of [...loggedSkips]) if (!liveSkips.has(tag)) loggedSkips.delete(tag);
    if (stopped) return;
    for (const [key, w] of wanted) {
      const existing = entries.get(key);
      if (existing) existing.members = w.members;
      else openEntry(w.key, w.members);
    }
    for (const entry of [...entries.values()]) if (!wanted.has(entry.key)) closeEntry(entry);
  }

  async function runReconcile(): Promise<void> {
    do {
      rerun = false;
      try {
        await reconcileOnce();
        lastReconcileError = null;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message !== lastReconcileError) {
          lastReconcileError = message;
          console.error(`[mission-engine] property watch: reconcile failed (registry left as is): ${message}`);
        }
      }
    } while (rerun && !stopped);
    running = null;
  }

  function reconcile(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (running) { rerun = true; return running; }
    running = runReconcile();
    return running;
  }

  function openEntry(key: PropertyWatchKey, members: Set<string>): void {
    const entry: WatchEntry = {
      ...key, members, stream: null, live: false, attempt: 0, retryTimer: null, lastReason: null, closed: false,
    };
    entries.set(key.key, entry);
    void connect(entry);
  }

  async function connect(entry: WatchEntry): Promise<void> {
    if (entry.closed || stopped) return;
    let handle: SseHandle;
    try {
      handle = await io.subscribe(entry, {
        onEvent: (e) => { if (e.type === 'property') void onPropertyEvent(entry); },
        onOpen: () => {
          if (entry.closed) return;
          entry.live = true;
          entry.attempt = 0;
          entry.lastReason = null;
          console.log(`[mission-engine] property watch live: ${entry.key}`);
        },
        onEnd: (reason) => {
          if (entry.closed) return;
          entry.live = false;
          entry.stream = null;
          scheduleRetry(entry, reason);
        },
      });
    } catch (err) {
      scheduleRetry(entry, `subscribe failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    if (entry.closed || stopped) { handle.close(); return; }
    entry.stream = handle;
  }

  /** §4.5: min(base · 2^attempt, max); a changed reason logs again, the same reason does not. */
  function scheduleRetry(entry: WatchEntry, reason: string): void {
    if (entry.closed || stopped) return;
    if (reason !== entry.lastReason) {
      entry.lastReason = reason;
      console.warn(`[mission-engine] property watch ${entry.key}: ${reason} — retrying with backoff; the gate keeps evaluating on its cycle`);
    }
    const delay = Math.min(backoffBase * 2 ** entry.attempt, backoffMax);
    entry.attempt += 1;
    if (entry.retryTimer) clearTimeout(entry.retryTimer);
    entry.retryTimer = setTimeout(() => { entry.retryTimer = null; void connect(entry); }, delay);
  }

  function closeEntry(entry: WatchEntry): void {
    entry.closed = true;
    entries.delete(entry.key);
    if (entry.retryTimer) { clearTimeout(entry.retryTimer); entry.retryTimer = null; }
    entry.stream?.close();
    entry.stream = null;
    entry.live = false;
  }

  /** §4.3: mark the members due; wake only when a row actually moved. */
  async function onPropertyEvent(entry: WatchEntry): Promise<void> {
    if (entry.closed || stopped) return;
    const members = [...entry.members];
    if (members.length === 0) return;
    try {
      const moved = await io.markDue(members);
      if (moved > 0) io.wake();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[mission-engine] property watch ${entry.key}: could not mark ${members.length} gate(s) due — the cycle still applies: ${message}`);
    }
  }

  function reconcileSoon(): void {
    if (stopped || debounceTimer) return;
    debounceTimer = setTimeout(() => { debounceTimer = null; void reconcile(); }, PROPERTY_WATCH_DEBOUNCE_MS);
  }

  const interval = setInterval(() => { void reconcile(); }, opts.reconcileMs);
  // Never keep the process alive on this timer alone (the HTTP server does that in production;
  // a test that forgets stop() must still exit). Cast: the DOM lib types setInterval as number.
  (interval as unknown as { unref?: () => void }).unref?.();

  return {
    reconcileSoon,
    reconcileNow: () => reconcile(),
    stop(): void {
      if (stopped) return;
      stopped = true;
      clearInterval(interval);
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
      for (const entry of [...entries.values()]) closeEntry(entry);
    },
    snapshot: () => [...entries.values()].map((e) => ({
      key: e.key, members: [...e.members].sort(), live: e.live, attempt: e.attempt, lastReason: e.lastReason,
    })),
  };
}

// ── Wiring (§4.7) ──

const NOOP_HANDLE: PropertyWatchHandle = {
  reconcileSoon() {},
  reconcileNow: async () => {},
  stop() {},
  snapshot: () => [],
};

/** §4.1/§4.7: build the registry over the real database, client and binding lookup, kick off the
 *  first reconcile, and return the handle. Two no-op outcomes, each logged once at boot: the kill
 *  switch (`PROPERTY_WATCH_ENABLED=false` — the engine then behaves exactly as before this spec),
 *  and a non-dispatching invoker (nullActionInvoker: no binding lookup, so no key could ever
 *  resolve). `client` is the same ActionClient the invoker dispatches through; `wake` is the loop
 *  handle's own wake(). `overrides` exists for tests (a short backoff). */
export function startPropertyWatch(
  db: Db, deps: EngineDeps, client: ActionClient, wake: () => void,
  overrides: Partial<PropertyWatchOptions> = {},
): PropertyWatchHandle {
  if (!deps.config.propertyWatchEnabled) {
    console.log('[mission-engine] property watch disabled (PROPERTY_WATCH_ENABLED=false) — bound gates evaluate on their cycle only');
    return NOOP_HANDLE;
  }
  const bindingLookup = deps.invoker.bindingLookup;
  if (!bindingLookup) {
    console.log('[mission-engine] property watch inactive — the action invoker does not dispatch, so no gate can bind a server');
    return NOOP_HANDLE;
  }
  const io: PropertyWatchIo = {
    loadGates: () => loadWaitingGates(db),
    resolve: (row) => resolveGateKeys(row, { bindingLookup, isAllowed: (uri) => client.isAllowed(uri) }),
    subscribe: (key, callbacks) => client.subscribePropertyEvents(key.serverUri, key.group, key.environmentOid, callbacks),
    markDue: (ids) => markGatesDue(db, deps.now(), ids),
    wake,
  };
  const handle = createPropertyWatch(io, { reconcileMs: deps.config.propertyWatchReconcileMs, ...overrides });
  void handle.reconcileNow();
  return handle;
}
