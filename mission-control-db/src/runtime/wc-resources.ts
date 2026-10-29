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

import { and, asc, eq, inArray } from 'drizzle-orm';
import { wcResource, wcResourceWaiter, wcResourceHolder } from '../db/schema/index.js';
import type { Schema } from '../db/client.js';
import type { PgDatabase } from 'drizzle-orm/pg-core';
type Db = PgDatabase<any, Schema>;

/** Postgres NOTIFY channel for a cross-instance resource grant. A release by one instance can
 *  make a DIFFERENT instance's queued Acquire grantable; the payload is that instance's id, so
 *  whichever engine replica is holding it can claim it immediately rather than waiting for its
 *  next idle sweep. Mirrors reconcile.ts's OPERATOR_CHANGE_CHANNEL pattern. */
export const NOTIFY_GRANT_CHANNEL = 'wc_resource_grant';

export type WcResourceRow = {
  workCenterId: string; name: string; resourceType: string;
  useLimit: number | null; poolNames: string[]; availableNames: string[]; inUse: number;
};

export type WcWaiterRow = {
  id: number; name: string; instanceId: string; stepOid: string; kind: string;
  amount: number | null; payload: string | null;
  granted: boolean; grantedName: string | null; grantedPayload: string | null;
};

export type WcRegistrySnapshot = { resources: WcResourceRow[]; waiters: WcWaiterRow[] };

export type HolderRow = { name: string; stepOid: string; amount: number; heldName: string | null };

export type RegistryWrites = {
  workCenterId: string;
  instanceId: string;
  counters: Array<{ name: string; inUse: number; availableNames: string[] }>;
  deleteWaiterIds: number[];
  grantWaiters: Array<{ id: number; grantedName: string | null; grantedPayload: string | null }>;
  insertWaiters: Array<{ name: string; stepOid: string; kind: string; amount: number | null; payload: string | null }>;
  /** The COMPLETE holder set for this instance after the transition — applied as
   *  delete-then-insert scoped to this instance, never touching another instance's rows. */
  holders: HolderRow[];
};

/**
 * Lock and read the work center's registry rows for exactly `names`, plus every waiter queued
 * on them (from ANY instance).
 *
 * LOCK ORDERING (spec §5.3): rows are locked `for update` ordered by NAME ASCENDING. The
 * caller has already locked its `workflow_instance` row, so the global order is
 * instance-row -> resource-rows-by-name, and an instance only ever touches its own work
 * center. That fixed order is the entire deadlock story — two instances acquiring the same two
 * resources in opposite COMMAND order still take the row locks in the same sequence.
 *
 * `names` is the set the frozen recipe references, NOT the work center's whole registry:
 * locking everything would serialize every transition in the work center behind every other.
 */
export async function lockRegistry(tx: Db, workCenterId: string, names: string[]): Promise<WcRegistrySnapshot> {
  if (names.length === 0) return { resources: [], waiters: [] };
  const resources = await tx.select({
    workCenterId: wcResource.workCenterId, name: wcResource.name,
    resourceType: wcResource.resourceType, useLimit: wcResource.useLimit,
    poolNames: wcResource.poolNames, availableNames: wcResource.availableNames,
    inUse: wcResource.inUse,
  }).from(wcResource)
    .where(and(eq(wcResource.workCenterId, workCenterId), inArray(wcResource.name, names)))
    .orderBy(asc(wcResource.name))
    .for('update');

  if (resources.length === 0) return { resources: [], waiters: [] };

  // Waiters are read WITHOUT their own row lock: every writer of a waiter row holds the parent
  // wc_resource row lock first (this function is the only door in), so the parent lock already
  // serializes them. Ordered by the identity column, which IS the FIFO order.
  const waiters = await tx.select({
    id: wcResourceWaiter.id, name: wcResourceWaiter.name, instanceId: wcResourceWaiter.instanceId,
    stepOid: wcResourceWaiter.stepOid, kind: wcResourceWaiter.kind, amount: wcResourceWaiter.amount,
    payload: wcResourceWaiter.payload, granted: wcResourceWaiter.granted,
    grantedName: wcResourceWaiter.grantedName, grantedPayload: wcResourceWaiter.grantedPayload,
  }).from(wcResourceWaiter)
    .where(and(
      eq(wcResourceWaiter.workCenterId, workCenterId),
      inArray(wcResourceWaiter.name, resources.map((r) => r.name)),
    ))
    .orderBy(asc(wcResourceWaiter.id));

  return { resources, waiters };
}

/** This instance's current holdings, for hydrating EngineState.envHolds and for auto-release. */
export async function readHolders(tx: Db, instanceId: string): Promise<HolderRow[]> {
  return tx.select({
    name: wcResourceHolder.name, stepOid: wcResourceHolder.stepOid,
    amount: wcResourceHolder.amount, heldName: wcResourceHolder.heldName,
  }).from(wcResourceHolder)
    .where(eq(wcResourceHolder.instanceId, instanceId))
    .orderBy(asc(wcResourceHolder.id));
}

/**
 * Apply one transition's registry mutations: counters, then waiter deletions, waiter grants,
 * then waiter insertions, then a wholesale per-instance holder replacement.
 *
 * A newly inserted waiter always lands at the TAIL of the FIFO identity sequence — but that
 * guarantee comes from `wc_resource_waiter.id` being `generatedAlwaysAsIdentity` (any newly
 * inserted row necessarily gets a higher id than every already-committed row), NOT from this
 * function's statement order. The delete-then-grant-then-insert order below has no functional
 * dependency on that guarantee — it just follows the conceptual sequence of a transition
 * (remove what's leaving the queue, promote what's being granted, then admit what's newly
 * queued) for readability.
 *
 * Holders are replaced wholesale FOR THIS INSTANCE ONLY. That is safe because
 * EngineState.envHolds is the authoritative in-transaction record of what this instance holds,
 * and it is persisted in the same transaction — the two can never disagree.
 */
export async function applyRegistryWrites(tx: Db, w: RegistryWrites): Promise<void> {
  for (const c of w.counters) {
    await tx.update(wcResource)
      .set({ inUse: c.inUse, availableNames: c.availableNames })
      .where(and(eq(wcResource.workCenterId, w.workCenterId), eq(wcResource.name, c.name)));
  }
  if (w.deleteWaiterIds.length > 0) {
    await tx.delete(wcResourceWaiter).where(inArray(wcResourceWaiter.id, w.deleteWaiterIds));
  }
  for (const g of w.grantWaiters) {
    await tx.update(wcResourceWaiter)
      .set({ granted: true, grantedName: g.grantedName, grantedPayload: g.grantedPayload })
      .where(eq(wcResourceWaiter.id, g.id));
  }
  if (w.insertWaiters.length > 0) {
    await tx.insert(wcResourceWaiter).values(w.insertWaiters.map((i) => ({
      workCenterId: w.workCenterId, name: i.name, instanceId: w.instanceId,
      stepOid: i.stepOid, kind: i.kind, amount: i.amount, payload: i.payload,
    })));
  }
  await tx.delete(wcResourceHolder).where(eq(wcResourceHolder.instanceId, w.instanceId));
  if (w.holders.length > 0) {
    await tx.insert(wcResourceHolder).values(w.holders.map((h) => ({
      workCenterId: w.workCenterId, name: h.name, instanceId: w.instanceId,
      stepOid: h.stepOid, amount: h.amount, heldName: h.heldName,
    })));
  }
}

/**
 * Drop everything this instance holds or waits on — the auto-release primitive (spec §5.5,
 * user decision U4). Returns the resource names touched, so the caller can re-grant on them.
 * Does NOT adjust counters: the caller re-runs the grant pass through the manager, which is the
 * single place pool arithmetic lives.
 *
 * Both deletes are keyed by instance_id alone: an instance belongs to exactly one work center,
 * so instance_id already disambiguates the row set. There is no `workCenterId` parameter —
 * one was not needed to scope the query, and keeping an unused parameter around just because an
 * earlier draft had it would be worse than an honest, minimal signature.
 */
export async function releaseInstanceHoldings(tx: Db, instanceId: string): Promise<string[]> {
  const touched = new Set<string>();
  const held = await tx.delete(wcResourceHolder)
    .where(eq(wcResourceHolder.instanceId, instanceId))
    .returning({ name: wcResourceHolder.name });
  for (const h of held) touched.add(h.name);
  const waited = await tx.delete(wcResourceWaiter)
    .where(eq(wcResourceWaiter.instanceId, instanceId))
    .returning({ name: wcResourceWaiter.name });
  for (const w of waited) touched.add(w.name);
  return [...touched];
}

/** A holder row as the operator verbs need it: the ledger row's own id (the CM sends it back
 *  as `holderId`) and its owning instance, on top of the HolderRow the engine already uses. */
export type ResourceHolderRow = HolderRow & { id: number; instanceId: string; acquiredAt: Date };

/**
 * Every holder row on ONE resource, from ANY instance, in id order. Read under the caller's
 * `lockRegistry` lock on that resource (Phase 4a `runWorkCenterResourceVerb`), which is what
 * makes the "unaccounted" arithmetic a verb does over these rows consistent with the counter
 * it just locked. Unlike `readHolders` (per instance, for hydration) this is per resource —
 * the operator's view, not an instance's.
 */
export async function readResourceHolders(tx: Db, workCenterId: string, name: string): Promise<ResourceHolderRow[]> {
  return tx.select({
    id: wcResourceHolder.id, instanceId: wcResourceHolder.instanceId, name: wcResourceHolder.name,
    stepOid: wcResourceHolder.stepOid, amount: wcResourceHolder.amount, heldName: wcResourceHolder.heldName,
    acquiredAt: wcResourceHolder.acquiredAt,
  }).from(wcResourceHolder)
    .where(and(eq(wcResourceHolder.workCenterId, workCenterId), eq(wcResourceHolder.name, name)))
    .orderBy(asc(wcResourceHolder.id));
}

/** What an OPERATOR verb writes (Phase 4a, spec §7.1). Structurally a subset of RegistryWrites:
 *  no `insertWaiters` (the operator never enqueues) and no wholesale per-instance `holders`
 *  replacement (the operator holds nothing; it deletes SPECIFIC rows of OTHER instances). */
export type OperatorRegistryWrites = {
  workCenterId: string;
  counters: RegistryWrites['counters'];
  deleteWaiterIds: number[];
  grantWaiters: RegistryWrites['grantWaiters'];
  deleteHolderIds: number[];
};

/**
 * Apply an operator verb's registry mutations. Deliberately NOT a mode of `applyRegistryWrites`:
 * that function's contract ("holders are replaced wholesale FOR THIS INSTANCE ONLY") is what
 * makes every transition's write-back correct, and an operator write must never be able to
 * touch it. Same statement order as a transition (counters, waiter deletes, grants) for
 * readability; the FIFO guarantee still comes from the identity column, not from this order.
 */
export async function applyOperatorRegistryWrites(tx: Db, w: OperatorRegistryWrites): Promise<void> {
  for (const c of w.counters) {
    await tx.update(wcResource)
      .set({ inUse: c.inUse, availableNames: c.availableNames })
      .where(and(eq(wcResource.workCenterId, w.workCenterId), eq(wcResource.name, c.name)));
  }
  if (w.deleteWaiterIds.length > 0) {
    await tx.delete(wcResourceWaiter).where(inArray(wcResourceWaiter.id, w.deleteWaiterIds));
  }
  for (const g of w.grantWaiters) {
    await tx.update(wcResourceWaiter)
      .set({ granted: true, grantedName: g.grantedName, grantedPayload: g.grantedPayload })
      .where(eq(wcResourceWaiter.id, g.id));
  }
  if (w.deleteHolderIds.length > 0) {
    await tx.delete(wcResourceHolder).where(inArray(wcResourceHolder.id, w.deleteHolderIds));
  }
}
