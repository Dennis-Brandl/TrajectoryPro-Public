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
// The translation layer between the work-center resource registry (rows) and the engine's
// existing synchronous InMemoryResourceManager (in-memory state). Pure functions over plain
// data — deliberately no database access and no WorkflowContext, so the trickiest logic in
// this phase is testable without either.
//
// TOKENS: an environment queue holds waiters from MANY instances, but a step oid is only
// unique within a recipe — two instances of the same workflow share step oids. So every
// environment queue entry is `${instanceId}::${stepOid}`. This is the "instance-prefixed
// variants for cross-workflow sync" the resources.ts header has always anticipated.
import type { SerializedResources, GrantEntry, InMemoryResourceManager } from './resources.js';
import type {
  WcRegistrySnapshot, WcWaiterRow, RegistryWrites, HolderRow,
} from 'mission-control-db/src/runtime/wc-resources';

// Identical shape to HolderRow by construction: this IS a holder row, just named for its role
// here. Aliasing (rather than retyping) means the two can never silently drift apart.
export type EnvHold = HolderRow;

const SEP = '::';

export function envToken(instanceId: string, stepOid: string): string {
  return `${instanceId}${SEP}${stepOid}`;
}

/** Splits on the FIRST separator only — a step oid is author-supplied and may itself contain
 *  '::', while an instance id is a uuid and never can. */
export function parseEnvToken(token: string): { instanceId: string; stepOid: string } {
  const at = token.indexOf(SEP);
  if (at < 0) return { instanceId: '', stepOid: token };
  return { instanceId: token.slice(0, at), stepOid: token.slice(at + SEP.length) };
}

/** Build the manager state for the environment tier. The resource KEY is the bare name:
 *  identity is (work center, name) — spec U2 — and the work center is implicit in the
 *  registry we loaded from. */
export function snapshotToSerialized(snap: WcRegistrySnapshot, workCenterId: string): SerializedResources {
  const pendingGrants: GrantEntry[] = [];
  const pendingNamedAssignments: [string, string][] = [];
  const syncMatchedData: [string, string][] = [];

  const waitersByName = new Map<string, WcWaiterRow[]>();
  for (const w of snap.waiters) {
    const list = waitersByName.get(w.name);
    if (list) list.push(w); else waitersByName.set(w.name, [w]);
  }

  const resources: SerializedResources['resources'] = [];
  for (const r of snap.resources) {
    const queued = (waitersByName.get(r.name) ?? []).filter((w) => !w.granted);
    const common = { ownerId: workCenterId, scope: 'environment' as const, resourceKey: r.name };
    switch (r.resourceType) {
      case 'binary exclusive use':
        // Straight pass-through of the row inUse value, matching the invariant resources.ts
        // itself relies on: acquire() only ever queues once inUse=1 (or the queue is already
        // non-empty, which only arises once inUse=1) - so a legitimately-reached registry row
        // can never carry inUse=0 alongside a non-empty queue. Do NOT derive/"self-heal" inUse
        // from queue non-emptiness here: the registry tables are shared and can reach states
        // this one hydration cannot fully see behind (e.g. a spec reload retyping a resource in
        // place - work-center-runtime.ts's upsertRegistryFromSpec changes resource_type without
        // touching in_use or waiter rows). Deriving inUse would PERSIST that anomaly forward via
        // diffRegistry's unconditional counter echo plus applyRegistryWrites' unconditional
        // UPDATE, wedging the resource at inUse=1 with no holder row that could ever release it.
        // A row that cannot legitimately occur is a data problem to fix at its source, not
        // something to paper over during hydration.
        resources.push([r.name, { type: 'binary exclusive use', inUse: (r.inUse > 0 ? 1 : 0) as 0 | 1,
          queue: queued.map((w) => envToken(w.instanceId, w.stepOid)), ...common }]);
        break;
      case 'binary shared use with pool limits':
        resources.push([r.name, { type: 'binary shared use with pool limits', inUse: r.inUse,
          useLimit: r.useLimit ?? 1, queue: queued.map((w) => envToken(w.instanceId, w.stepOid)), ...common }]);
        break;
      case 'countable use with pool limits':
        resources.push([r.name, { type: 'countable use with pool limits', inUse: r.inUse,
          useLimit: r.useLimit ?? 1,
          queue: queued.map((w) => ({ stepOid: envToken(w.instanceId, w.stepOid), amount: w.amount ?? 1 })),
          ...common }]);
        break;
      case 'named pool':
        resources.push([r.name, { type: 'named pool', available: [...r.availableNames],
          originalNames: [...r.poolNames],
          queue: queued.map((w) => envToken(w.instanceId, w.stepOid)), ...common }]);
        break;
      case 'sync':
        resources.push([r.name, { type: 'sync',
          sendQueue: queued.filter((w) => w.kind === 'send')
            .map((w) => ({ stepOid: envToken(w.instanceId, w.stepOid), data: w.payload ?? '' })),
          receiveQueue: queued.filter((w) => w.kind === 'receive').map((w) => envToken(w.instanceId, w.stepOid)),
          pendingSync: queued.filter((w) => w.kind === 'sync').map((w) => envToken(w.instanceId, w.stepOid)),
          ...common }]);
        break;
      default:
        // Unknown type: skip rather than throw. A load already warned about it (Phase 1's
        // declarationProblem), and failing a transition over a row we cannot model would
        // punish a running workflow for an authoring problem.
        break;
    }
  }

  // Granted waiters are NOT queue entries — they are handoffs waiting to be consumed.
  for (const w of snap.waiters) {
    if (!w.granted) continue;
    const token = envToken(w.instanceId, w.stepOid);
    pendingGrants.push({ stepOid: token, resourceKey: w.name });
    if (w.grantedName !== null) pendingNamedAssignments.push([token, w.grantedName]);
    if (w.grantedPayload !== null) syncMatchedData.push([token, w.grantedPayload]);
  }

  return { resources, pendingGrants, syncMatchedData, pendingNamedAssignments };
}

export type LoadedWaiterIndex = Map<string, number>;

// Joined with a NUL byte, not a printable one: a Postgres text/varchar column cannot contain a
// NUL byte, so this key can never collide with a resource name (which may itself contain
// spaces, or any other printable character a token could also contain).
const indexKey = (name: string, token: string) => `${name}\u0000${token}`;

/** Map (resource name, token) -> the waiter row id it was loaded from, so write-back can tell
 *  "still queued, keep its row and its FIFO position" from "newly queued, insert at the tail".
 *  A row already granted at load time is NOT indexed here - it is not in any queue - but
 *  diffRegistry still needs to account for it; see the granted-at-load pass there. */
export function indexWaiters(snap: WcRegistrySnapshot): LoadedWaiterIndex {
  const index: LoadedWaiterIndex = new Map();
  for (const w of snap.waiters) {
    if (w.granted) continue; // a granted row is not in any queue
    index.set(indexKey(w.name, envToken(w.instanceId, w.stepOid)), w.id);
  }
  return index;
}

/** Every token currently queued on `name`, in the manager's own order. Exported for the
 *  operator verbs (Phase 4a): a per-resource `cancel-waiter` guard must ask about ONE resource's
 *  queue, which is exactly this — never allManagerTokens, whose union spans every resource and
 *  also includes already-granted tokens parked in `pendingGrants`. */
export function queuedTokens(manager: InMemoryResourceManager, name: string): { token: string; kind: string; amount: number | null; payload: string | null }[] {
  const raw = (manager as unknown as { resources: Map<string, any> }).resources.get(name);
  if (!raw) return [];
  switch (raw.type) {
    case 'binary exclusive use':
    case 'binary shared use with pool limits':
    case 'named pool':
      return raw.queue.map((t: string) => ({ token: t, kind: 'acquire', amount: null, payload: null }));
    case 'countable use with pool limits':
      return raw.queue.map((q: { stepOid: string; amount: number }) => ({
        token: q.stepOid, kind: 'acquire', amount: q.amount, payload: null,
      }));
    case 'sync':
      return [
        ...raw.sendQueue.map((s: { stepOid: string; data: string }) => ({ token: s.stepOid, kind: 'send', amount: null, payload: s.data })),
        ...raw.receiveQueue.map((t: string) => ({ token: t, kind: 'receive', amount: null, payload: null })),
        ...raw.pendingSync.map((t: string) => ({ token: t, kind: 'sync', amount: null, payload: null })),
      ];
    default:
      return [];
  }
}

/**
 * Every token this manager currently knows about, across EVERY resource: each queue entry (of
 * any type) plus every token parked in `pendingGrants`. Lives here, beside `queuedTokens`, so
 * the per-type queue shapes — and the private-state cast that reaches them — have exactly one
 * home; context.ts's `ownEnvTokens` filters this by token ownership rather than re-deriving it.
 *
 * Whole-branch review C2: the environment sweeps used to derive their token set from the SPEC
 * TREE (`envSweepTokens(id, knownStepOids(ctx))`), which cannot see a step whose `childActive`
 * link was already torn down — so a torn-down child's queued token was invisible to every
 * sweep. The manager itself always knows; deriving from it can never under-cover.
 */
export function allManagerTokens(manager: InMemoryResourceManager): string[] {
  const raw = (manager as unknown as { resources: Map<string, any> }).resources;
  const tokens: string[] = [];
  for (const name of raw.keys()) {
    for (const q of queuedTokens(manager, name)) tokens.push(q.token);
  }
  for (const g of (manager as unknown as { pendingGrants: GrantEntry[] }).pendingGrants) {
    tokens.push(g.stepOid);
  }
  return tokens;
}

/** The manager's live counters for `name`, in the registry's column shape. */
function countersFor(manager: InMemoryResourceManager, name: string): { inUse: number; availableNames: string[] } | null {
  const raw = (manager as unknown as { resources: Map<string, any> }).resources.get(name);
  if (!raw) return null;
  if (raw.type === 'named pool') {
    return { inUse: raw.originalNames.size - raw.available.length, availableNames: [...raw.available] };
  }
  if (raw.type === 'sync') return { inUse: 0, availableNames: [] };
  return { inUse: raw.inUse, availableNames: [] };
}

/**
 * Turn "what the manager looks like now" into the writes that make the registry match.
 *
 * The manager only ever shifts from a queue's head and pushes to its tail, so a token present
 * in both the loaded snapshot and the current manager keeps its ORIGINAL row — and therefore
 * its original identity value, and therefore its FIFO position. That is what makes cross-
 * instance ordering survive a write-back at all.
 *
 * A token that LEFT a queue is either granted (it appears in the manager's pendingGrants) or
 * cancelled. A grant for this instance is consumed in-transaction, so its row is deleted; a
 * grant for a foreign instance keeps its row and is FLAGGED, which is the handoff.
 *
 * A row that was ALREADY granted when it was loaded (the other half of that same handoff, seen
 * from the receiving side) never appears in `index` at all — snapshotToSerialized excludes it
 * from every queue and instead seeds it straight into the manager's pendingGrants. If THIS
 * instance consumes that grant during the transition (it leaves manager.pendingGrants), the row
 * must be deleted here too: otherwise the next hydration re-seeds the same pendingGrant with no
 * capacity behind it, and a step that re-acquires the same resource could resume as granted for
 * free. A foreign instance's granted-at-load row is left alone either way — it is not this
 * instance's to delete or reinterpret.
 */
export function diffRegistry(args: {
  snap: WcRegistrySnapshot;
  manager: InMemoryResourceManager;
  index: LoadedWaiterIndex;
  instanceId: string;
  holds: EnvHold[];
}): Omit<RegistryWrites, 'workCenterId' | 'instanceId'> & { foreignGrantInstanceIds: string[] } {
  const { snap, manager, index, instanceId, holds } = args;

  const counters: RegistryWrites['counters'] = [];
  const insertWaiters: RegistryWrites['insertWaiters'] = [];
  const stillQueued = new Set<string>();

  for (const r of snap.resources) {
    const c = countersFor(manager, r.name);
    if (c) counters.push({ name: r.name, inUse: c.inUse, availableNames: c.availableNames });
    for (const q of queuedTokens(manager, r.name)) {
      const key = indexKey(r.name, q.token);
      const existing = index.get(key);
      if (existing !== undefined) { stillQueued.add(key); continue; }
      const { instanceId: owner, stepOid } = parseEnvToken(q.token);
      // A transition can only ever enqueue ITS OWN steps; a foreign token that is not already
      // in the index would be a bug, so skip rather than mis-attribute it to this instance.
      //
      // Whole-branch review I4: BEHAVIOR unchanged (still skipped) — but no longer silently.
      // "Would be a bug" is verbatim the reasoning a real-Postgres run falsified for a sibling
      // branch, and this branch drops a queue entry that the registry will then have no row
      // for: the token keeps its place in THIS manager's queue but not in the FIFO of record,
      // so the next hydration silently loses it. If it ever fires, the log is the only trace.
      if (owner !== instanceId) {
        console.warn(
          `[mission-engine] instance ${instanceId}: write-back found a FOREIGN queued token ` +
          `"${q.token}" on resource "${r.name}" with no matching wc_resource_waiter row loaded ` +
          'in this hydration — skipping it rather than mis-attributing the row to this instance ' +
          '(this state is believed unreachable: a transition can only enqueue its own steps)',
        );
        continue;
      }
      insertWaiters.push({ name: r.name, stepOid, kind: q.kind, amount: q.amount, payload: q.payload });
    }
  }

  // Grants still parked in the manager belong to instances that did not consume them here.
  const parked = new Map<string, GrantEntry>();
  for (const g of (manager as unknown as { pendingGrants: GrantEntry[] }).pendingGrants) {
    parked.set(indexKey(g.resourceKey, g.stepOid), g);
  }
  const namedAssignments = new Map(
    (manager as unknown as { pendingNamedAssignments: Map<string, string> }).pendingNamedAssignments,
  );
  const matchedData = new Map(
    (manager as unknown as { syncMatchedData: Map<string, string> }).syncMatchedData,
  );

  const deleteWaiterIds: number[] = [];
  const grantWaiters: RegistryWrites['grantWaiters'] = [];
  const foreignGrantInstanceIds: string[] = [];

  for (const [key, id] of index) {
    if (stillQueued.has(key)) continue;             // untouched, keeps its row and position
    const grant = parked.get(key);
    if (!grant) { deleteWaiterIds.push(id); continue; }   // cancelled, or consumed by us
    const { instanceId: owner } = parseEnvToken(grant.stepOid);
    if (owner === instanceId) { deleteWaiterIds.push(id); continue; } // ours; becomes a holder
    grantWaiters.push({
      id,
      grantedName: namedAssignments.get(grant.stepOid) ?? null,
      grantedPayload: matchedData.get(grant.stepOid) ?? null,
    });
    if (!foreignGrantInstanceIds.includes(owner)) foreignGrantInstanceIds.push(owner);
  }

  // Rows already granted when they were loaded, restricted to THIS instance - a foreign
  // instance's granted-at-load row is never this instance's to touch.
  const grantedAtLoad = new Map<string, number>();
  for (const w of snap.waiters) {
    if (!w.granted || w.instanceId !== instanceId) continue;
    grantedAtLoad.set(indexKey(w.name, envToken(w.instanceId, w.stepOid)), w.id);
  }
  for (const [key, id] of grantedAtLoad) {
    if (!parked.has(key)) deleteWaiterIds.push(id); // gone from pendingGrants -> consumed here
  }

  return { counters, deleteWaiterIds, grantWaiters, insertWaiters, holders: holds, foreignGrantInstanceIds };
}
