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
// Phase 4a (spec §7.1): the operator verbs' PURE core. Given a manager hydrated from a locked
// registry snapshot, the resource's holder ledger and the verb, mutate the manager exactly as
// a transition would and report which rows the caller must delete and which instances it must
// wake. No database, no context — the same testability split env-resource-bridge.ts made.
//
// The manager is the ONLY arithmetic. release()/releaseAmount()/releaseNamed() run the FIFO
// grant pass; resetResources() restores the initial state and re-grants; cancelQueuedWaiters()
// dequeues. diffRegistry (run by the caller with OPERATOR_INSTANCE_ID) then turns the manager's
// new shape into counters + waiter deletes + FOREIGN grants — the operator never enqueues and
// never holds, so every grant is a handoff to another instance.
import type { InMemoryResourceManager } from './resources.js';
import { envToken } from './env-resource-bridge.js';
import type { WcResourceRow, WcWaiterRow, ResourceHolderRow } from 'mission-control-db/src/runtime/wc-resources';

/** The nil uuid: a valid uuid no instance can ever have, so diffRegistry classifies every
 *  grant as foreign and every surviving queue entry as somebody else's. Also the value the
 *  write-back would attribute an inserted waiter to — which is why an operator diff with a
 *  non-empty insertWaiters is asserted against, never written. */
export const OPERATOR_INSTANCE_ID = '00000000-0000-0000-0000-000000000000';

export const RESOURCE_VERBS = ['release-holder', 'release', 'reset', 'cancel-waiter', 'clear-sync'] as const;
export type ResourceVerb = (typeof RESOURCE_VERBS)[number];

export type VerbErrorCode =
  | 'VALIDATION' | 'RESOURCE_NOT_FOUND' | 'HOLDER_NOT_FOUND' | 'WAITER_NOT_FOUND'
  | 'NOTHING_TO_RELEASE' | 'NOT_A_SYNC_RESOURCE' | 'NOT_SUPPORTED'
  | 'RUNTIME_NOT_FOUND' | 'RUNTIME_INVALID_STATE' | 'INSTANCE_BUSY'
  | 'VALUE_NOT_FOUND' | 'SHARED_KEY' | 'CHILD_NOT_ACTIVE'
  // Spec 2026-10-13 §5.1: force complete.
  | 'INSTANCE_PAUSED' | 'STEP_NOT_FOUND' | 'ALREADY_COMPLETED' | 'ALREADY_OPEN' | 'NOT_FORCEABLE';

/** Thrown by every verb; the internal route maps `code` to a status (Task 7). The message is
 *  operator-facing — it is what the Mission Commander toasts, so it never carries the code. */
export class VerbError extends Error {
  constructor(readonly code: VerbErrorCode, message: string) { super(message); this.name = 'VerbError'; }
}

export type ResourceVerbInput = {
  verb: ResourceVerb; name: string;
  holderId?: number; waiterId?: number; amount?: number; poolName?: string;
};

export type ResourceVerbEffect = {
  /** wc_resource_holder ids to delete (release-holder: one; reset: all on the resource). */
  deleteHolderIds: number[];
  /** wc_resource_waiter ids diffRegistry will NOT delete on its own: rows that were already
   *  `granted` when loaded (they are absent from the waiter index by design) but must go. */
  extraDeleteWaiterIds: number[];
  /** Instances whose state this verb changed from the outside (holders released, waiters
   *  cancelled). Grantees are NOT here — diffRegistry reports those as foreignGrantInstanceIds. */
  affectedInstanceIds: string[];
  /** Per-step trace lines the runner writes on the affected instances (spec §7.1). */
  touched: Array<{ instanceId: string; stepOid: string; detail: string }>;
  summary: string;
};

const COUNTED = new Set(['binary exclusive use', 'binary shared use with pool limits', 'countable use with pool limits']);
/** The five types snapshotToSerialized can model. `WcResourceRow.resourceType` is an open string
 *  (Phase 1's declarationProblem only WARNS about an unknown one), and a row outside this set is
 *  absent from the manager entirely — so no verb may act on one. */
const KNOWN_TYPES = new Set([...COUNTED, 'named pool', 'sync']);
const units = (w: { amount: number | null }) => w.amount ?? 1;

/**
 * Spec §4.1's "unaccounted" figure, extended by delta D14: what the counter holds that neither a
 * holder row nor a still-reserved grant can explain. A granted-but-unconsumed waiter row has
 * capacity reserved for it (its grantor's tryGrantXxx already bumped the counter) even though no
 * holder row exists yet (§12.4 item 15) — releasing "unaccounted" units without subtracting those
 * would strip a grantee that is milliseconds from consuming its grant.
 */
export function untrackedCapacity(row: WcResourceRow, holders: ResourceHolderRow[], waiters: WcWaiterRow[]): { units: number; names: string[] } {
  // Review Important 1: scope to THIS resource. `waiters` may be a whole-work-center list, and
  // another resource's granted-unconsumed row would inflate this ledger (counted types) or
  // absorb a name this pool really has untracked (pools commonly share short names) — either
  // way `release` would refuse a genuinely untracked unit, and refuse it with a wrong figure
  // in the operator-facing message. Every other verb already filters on `w.name === row.name`.
  const granted = waiters.filter((w) => w.name === row.name && w.granted);
  if (row.resourceType === 'named pool') {
    const held = row.poolNames.filter((n) => !row.availableNames.includes(n));
    const tracked = new Set([...holders.map((h) => h.heldName), ...granted.map((w) => w.grantedName)]);
    const names = held.filter((n) => !tracked.has(n));
    return { units: names.length, names };
  }
  if (!COUNTED.has(row.resourceType)) return { units: 0, names: [] };
  const ledger = holders.reduce((s, h) => s + h.amount, 0) + granted.reduce((s, w) => s + units(w), 0);
  return { units: Math.max(0, row.inUse - ledger), names: [] };
}

function releaseOne(manager: InMemoryResourceManager, row: WcResourceRow, amount: number, heldName: string | null): boolean {
  switch (row.resourceType) {
    case 'binary exclusive use':
    case 'binary shared use with pool limits':
      return manager.release(row.name);
    case 'countable use with pool limits':
      return manager.release(row.name, amount);
    case 'named pool':
      if (!heldName) throw new VerbError('NOTHING_TO_RELEASE', `holder on named pool "${row.name}" has no held name to return`);
      return manager.release(row.name, undefined, heldName);
    default:
      throw new VerbError('NOT_SUPPORTED', `"${row.name}" is a ${row.resourceType} resource — it has nothing to release`);
  }
}

/**
 * Clearing a sync resource — the body `clear-sync` has always run, and (review Important 2) the
 * body `reset` runs too. A sync resource has no counter and no holder ledger, so "restore it to
 * its initial state" and "drop every parked send/receive/synchronize" are the same operation;
 * spec §7.1 has both verbs call resetResources, and §7.3 offers Reset on every registry row, so
 * refusing Reset here would contradict the pane. `verb` only labels the trace and the summary.
 *
 * Ruling P4 (hygiene): a granted send/receive is parked in pendingGrants, which resetResources
 * does not clear. Drop those grants too so the manager carries nothing for rows we delete.
 */
function clearSyncEffect(
  manager: InMemoryResourceManager, row: WcResourceRow, waiters: WcWaiterRow[], verb: 'reset' | 'clear-sync',
): ResourceVerbEffect {
  const mine = waiters.filter((w) => w.name === row.name);
  manager.cancelQueuedWaiters(new Set(mine.filter((w) => w.granted).map((w) => envToken(w.instanceId, w.stepOid))));
  manager.resetResources(new Set([row.name])); // clears sendQueue / receiveQueue / pendingSync
  return {
    deleteHolderIds: [],
    extraDeleteWaiterIds: mine.filter((w) => w.granted).map((w) => w.id),
    affectedInstanceIds: [...new Set(mine.map((w) => w.instanceId))],
    touched: mine.map((w) => ({ instanceId: w.instanceId, stepOid: w.stepOid, detail: `${verb} "${row.name}" — ${w.kind} cancelled by an operator` })),
    summary: `${verb} "${row.name}" (${mine.length} waiter row(s) dropped)`,
  };
}

export function applyResourceVerb(args: {
  manager: InMemoryResourceManager; row: WcResourceRow; holders: ResourceHolderRow[]; waiters: WcWaiterRow[]; input: ResourceVerbInput;
}): ResourceVerbEffect {
  const { manager, row, holders, waiters, input } = args;
  if (!(RESOURCE_VERBS as readonly string[]).includes(input.verb)) {
    throw new VerbError('VALIDATION', `unknown verb "${String(input.verb)}"`);
  }
  const none: ResourceVerbEffect = { deleteHolderIds: [], extraDeleteWaiterIds: [], affectedInstanceIds: [], touched: [], summary: '' };

  switch (input.verb) {
    case 'release-holder': {
      const h = holders.find((x) => x.id === input.holderId);
      if (!h) throw new VerbError('HOLDER_NOT_FOUND', `no holder ${input.holderId ?? '?'} on "${row.name}"`);
      const released = releaseOne(manager, row, h.amount, h.heldName);
      const detail = `release-holder "${row.name}"${h.heldName ? ` (${h.heldName})` : ''} amount ${h.amount}`;
      return {
        ...none, deleteHolderIds: [h.id], affectedInstanceIds: [h.instanceId],
        touched: [{ instanceId: h.instanceId, stepOid: h.stepOid, detail }],
        summary: released ? detail : `${detail} — ledger row removed; the counter was already free (ledger mismatch)`,
      };
    }
    case 'release': {
      const cap = untrackedCapacity(row, holders, waiters);
      if (row.resourceType === 'named pool') {
        if (!input.poolName) throw new VerbError('VALIDATION', `poolName is required to release a name from "${row.name}"`);
        if (!cap.names.includes(input.poolName)) {
          throw new VerbError('NOTHING_TO_RELEASE', `"${input.poolName}" on "${row.name}" is ${cap.names.length ? `tracked; untracked names: ${cap.names.join(', ')}` : 'not an untracked held name'}`);
        }
        manager.release(row.name, undefined, input.poolName);
        return { ...none, summary: `release untracked name "${input.poolName}" on "${row.name}"` };
      }
      if (!COUNTED.has(row.resourceType)) throw new VerbError('NOT_SUPPORTED', `"${row.name}" is a ${row.resourceType} resource — use clear-sync`);
      const amount = input.amount ?? 1;
      if (!Number.isInteger(amount) || amount < 1) throw new VerbError('VALIDATION', 'amount must be a positive integer');
      if (row.resourceType !== 'countable use with pool limits' && amount !== 1) throw new VerbError('VALIDATION', `"${row.name}" releases one unit at a time`);
      if (cap.units < amount) throw new VerbError('NOTHING_TO_RELEASE', `"${row.name}" has only ${cap.units} unaccounted unit(s); every other unit is held by a runtime workflow or reserved by a grant — use release-holder`);
      releaseOne(manager, row, amount, null);
      return { ...none, summary: `release ${amount} untracked unit(s) on "${row.name}"` };
    }
    case 'reset': {
      // Review Important 2: a type the engine cannot model is absent from the manager entirely —
      // resetResources skips the missing key and diffRegistry emits NO counter for it — yet the
      // effect below would still delete every holder row. That is in_use non-zero with zero
      // holders and zero waiters: the wedge shape, manufactured by the recovery verb. Refuse
      // before anything is mutated. (releaseOne and clear-sync already guard their own paths.)
      if (!KNOWN_TYPES.has(row.resourceType)) {
        throw new VerbError('NOT_SUPPORTED', `"${row.name}" is a ${row.resourceType} resource — the engine cannot model it, so there is no state to reset`);
      }
      // A sync resource has no counter and no holders: resetting it IS clearing its queues.
      if (row.resourceType === 'sync') return clearSyncEffect(manager, row, waiters, 'reset');
      // Ruling P4: drop every unconsumed grant BEFORE resetting — resetResources zeroes the counter
      // but leaves pendingGrants alone, and restores a named pool's roster while a reserved name is
      // still assigned. cancelQueuedWaiters drops the grants and returns reserved names.
      const grantedRows = waiters.filter((w) => w.name === row.name && w.granted);
      manager.cancelQueuedWaiters(new Set(grantedRows.map((w) => envToken(w.instanceId, w.stepOid))));
      manager.resetResources(new Set([row.name]));
      const affected = [...new Set([...holders.map((h) => h.instanceId), ...grantedRows.map((w) => w.instanceId)])];
      return {
        ...none,
        deleteHolderIds: holders.map((h) => h.id),
        extraDeleteWaiterIds: grantedRows.map((w) => w.id),
        affectedInstanceIds: affected,
        touched: [
          ...holders.map((h) => ({ instanceId: h.instanceId, stepOid: h.stepOid, detail: `reset "${row.name}" — hold dropped by an operator` })),
          ...grantedRows.map((w) => ({ instanceId: w.instanceId, stepOid: w.stepOid, detail: `reset "${row.name}" — unconsumed grant dropped by an operator` })),
        ],
        summary: `reset "${row.name}" (${holders.length} holder row(s) dropped, ${grantedRows.length} unconsumed grant(s) dropped; queue preserved)`,
      };
    }
    case 'clear-sync': {
      if (row.resourceType !== 'sync') throw new VerbError('NOT_A_SYNC_RESOURCE', `"${row.name}" is a ${row.resourceType} resource, not sync`);
      return clearSyncEffect(manager, row, waiters, 'clear-sync');
    }
    case 'cancel-waiter': {
      const w = waiters.find((x) => x.id === input.waiterId && x.name === row.name);
      if (!w) throw new VerbError('WAITER_NOT_FOUND', `no waiter ${input.waiterId ?? '?'} on "${row.name}"`);
      const token = envToken(w.instanceId, w.stepOid);
      manager.cancelQueuedWaiters(new Set([token]));
      if (w.granted) {
        // D13: the grant reserved capacity at grant time; cancelQueuedWaiters only returned a
        // named-pool NAME. Give a counted type's unit(s) back so the FIFO can hand them on.
        if (COUNTED.has(row.resourceType)) releaseOne(manager, row, units(w), null);
        else manager.runGrantPass(row.name);
      } else {
        manager.runGrantPass(row.name); // a removed countable head can unblock a smaller request
      }
      const detail = `cancel-waiter "${row.name}" (${w.kind}${w.granted ? ', granted' : ''}) — wait cancelled by an operator`;
      return {
        ...none, extraDeleteWaiterIds: w.granted ? [w.id] : [], affectedInstanceIds: [w.instanceId],
        touched: [{ instanceId: w.instanceId, stepOid: w.stepOid, detail }], summary: detail,
      };
    }
  }
}
