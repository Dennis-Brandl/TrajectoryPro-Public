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
// Spec 2026-11-26: a commander changes a work-center resource's shares, count or names. Same
// transaction shape as a work-center verb (operator-verbs.ts): lock the ONE registry row, write
// the new capacity, hydrate a manager from the changed snapshot, run the grant pass the new room
// allows, write the handoffs and wake each granted instance. Holders are never touched: a lower
// count lets current holds finish, and a removed held name is retired (in neither array), so the
// next release discards it.
import { and, eq, sql } from 'drizzle-orm';
import { wcResource } from 'mission-control-db/src/db/schema/index';
import { lockRegistry, applyOperatorRegistryWrites, NOTIFY_GRANT_CHANNEL } from 'mission-control-db/src/runtime/wc-resources';
import {
  checkPoolNames, freeNamesAfter, isCountedType, readHeldNames, validUseLimit, NAMED_TYPE,
} from 'mission-control-db/src/runtime/resource-capacity';
import type { Db } from '../db.js';
import type { EngineDeps } from '../config.js';
import type { OperatorEventHub } from '../api/events.js';
import { InMemoryResourceManager } from './resources.js';
import { snapshotToSerialized, indexWaiters, diffRegistry } from './env-resource-bridge.js';
import { OPERATOR_INSTANCE_ID, VerbError } from './registry-verbs.js';
import type { VerbResult } from './operator-verbs.js';

export type SetCapacityInput = {
  workCenterId: string; name: string; actorUserId: string;
  useLimit?: number; names?: string[];
};

export async function setResourceCapacityTx(tx: Db, now: Date, input: SetCapacityInput): Promise<VerbResult> {
  const snap = await lockRegistry(tx, input.workCenterId, [input.name]);
  const row = snap.resources[0];
  if (!row) throw new VerbError('RESOURCE_NOT_FOUND', `no resource "${input.name}" in this work center`);

  let next: typeof row;
  if (isCountedType(row.resourceType)) {
    if (input.names !== undefined || input.useLimit === undefined) throw new VerbError('VALIDATION', `"${row.name}" takes a number, not names`);
    if (!validUseLimit(input.useLimit)) throw new VerbError('VALIDATION', 'the number must be a whole number of at least 1');
    next = { ...row, useLimit: input.useLimit };
  } else if (row.resourceType === NAMED_TYPE) {
    if (input.useLimit !== undefined || input.names === undefined) throw new VerbError('VALIDATION', `"${row.name}" takes names, not a number`);
    const list = checkPoolNames(input.names);
    if (typeof list === 'string') throw new VerbError('VALIDATION', list);
    const free = freeNamesAfter(row.availableNames, row.poolNames, list, await readHeldNames(tx, input.workCenterId, input.name));
    next = { ...row, poolNames: list, availableNames: free };
  } else {
    throw new VerbError('NOT_SUPPORTED', `"${row.name}" is a ${row.resourceType} resource, which has no count or names to change`);
  }

  await tx.update(wcResource).set({
    useLimit: next.useLimit, poolNames: next.poolNames, availableNames: next.availableNames,
    capacitySetBy: input.actorUserId, capacitySetAt: now, updatedAt: now,
  }).where(and(eq(wcResource.workCenterId, input.workCenterId), eq(wcResource.name, input.name)));

  // The grant pass runs on the CHANGED row, so a raised count or a new name goes to the head of
  // the queue now instead of waiting for some unrelated release.
  const changed = { ...snap, resources: [next] };
  const manager = InMemoryResourceManager.fromJSON(snapshotToSerialized(changed, input.workCenterId));
  manager.runGrantPass(input.name);
  const d = diffRegistry({ snap: changed, manager, index: indexWaiters(changed), instanceId: OPERATOR_INSTANCE_ID, holds: [] });
  if (d.insertWaiters.length > 0) {
    throw new Error(`set-capacity on "${input.name}" produced ${d.insertWaiters.length} waiter insert(s) — refusing to write`);
  }
  await applyOperatorRegistryWrites(tx, {
    workCenterId: input.workCenterId, counters: d.counters, deleteWaiterIds: d.deleteWaiterIds,
    grantWaiters: d.grantWaiters, deleteHolderIds: [],
  });
  const wake = [...new Set(d.foreignGrantInstanceIds)];
  for (const id of wake) await tx.execute(sql`SELECT pg_notify(${NOTIFY_GRANT_CHANNEL}, ${id})`);
  const what = next.resourceType === 'named pool' ? `names [${next.poolNames.join(', ')}]` : `limit ${next.useLimit}`;
  return { ok: true, summary: `set-capacity "${input.name}" to ${what}`, affectedInstanceIds: wake };
}

export async function setResourceCapacity(
  db: Db, deps: EngineDeps, hub: OperatorEventHub | null, input: SetCapacityInput,
): Promise<VerbResult> {
  const now = deps.now();
  const result = await db.transaction((tx) => setResourceCapacityTx(tx as unknown as Db, now, input));
  hub?.notifyWorkCenter(input.workCenterId); // this process's SSE clients; other replicas poll
  return result;
}
