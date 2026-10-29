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

import { and, asc, eq, getTableColumns, inArray } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import {
  wcResource, wcResourceHolder, wcResourceWaiter, wcValueProperty, workflowInstance, workCenter, environmentSpec, appUser,
  type WcWaiterKind,
} from '../db/schema/index.js';
import type { Schema } from '../db/client.js';
import { summarizeRegistryRow, summarizeResource, type ResourceSummary } from '../runtime/resource-summary.js';
import { readRegistrySource } from './work-center-runtime.js';

type Db = PgDatabase<any, Schema>;

// Phase 3 (spec §6): the READ surface over the work-center shared-state registry. Reads stay
// on DAOs (S5) — the engine is never consulted. Every function here is polled at 2 s by a
// pane, so projections stay narrow: spec_jsonb is loaded server-side for step names and never
// reaches a return value.

// ── Types (the wire contract the Mission Commander mirrors — see src/index.ts) ────────────────

/** Who defined a registry row. `envSpecId` NULL means ORPHANED: the declaring spec was deleted
 *  and the row outlived it (spec §4.1); the text columns survive so the pane can still say what
 *  defined it. `name` prefers the live environment_spec.name and falls back to the denormalized
 *  defined_from_name — the same rule materialization's conflict warning uses. */
export type ResourceProvenance = { envSpecId: string | null; name: string | null; version: string | null; state: string | null };

export type SharedResourceHolder = {
  /** wc_resource_holder.id — what Phase 4's `release-holder` verb names (plan 4b delta D18). */
  id: number;
  instanceId: string; runtimeNumber: number; runtimeLabel: string; masterName: string;
  stepOid: string; stepName: string | null;
  amount: number; heldName: string | null; acquiredAt: Date;
};

/** FIFO order is the row's identity id (schema comment on wc_resource_waiter) — callers receive
 *  waiters already in that order. `granted` marks a cross-instance handoff the target instance
 *  has not consumed yet (spec §5.4). */
export type SharedResourceWaiter = {
  id: number; instanceId: string; runtimeNumber: number; runtimeLabel: string; masterName: string;
  stepOid: string; stepName: string | null;
  kind: WcWaiterKind; amount: number | null; granted: boolean; enqueuedAt: Date;
};

export type SharedResourceView = {
  workCenterId: string; name: string; resourceType: string; description: string | null;
  useLimit: number | null; poolNames: string[]; availableNames: string[]; inUse: number;
  /** The engine's own vocabulary ("Free", "2/3 in use", …) — spec §6.1. */
  summary: ResourceSummary;
  /** Spec §4.1, per type: counted types → in_use − Σ holder.amount; named pool → held roster
   *  names with no holder row; sync → null (no capacity, only queues). Clamped at 0. */
  unaccounted: number | null;
  /** Spec §12.1 item 7: the holder ledger claims MORE than the counters do (a cross-type
   *  redeclaration stranded holder rows, or a holder names a free pool name). Rendered as a
   *  badge rather than a negative number. */
  ledgerMismatch: boolean;
  /** Spec §4.6 / §6.3: in_use exceeds the resolved capacity (`summary.total`, which already
   *  applies the use_limit ?? 1 default exactly once) — a shrunk use_limit, or a never-set one
   *  on a count-1 pool. A NULL use_limit is never "unlimited". */
  overCommitted: boolean;
  holders: SharedResourceHolder[];
  waiters: SharedResourceWaiter[];
  definedBy: ResourceProvenance;
  orphaned: boolean;
  updatedAt: Date;
};

/** Spec §6.2: the work-center rows FILTERED to the names this spec declares. `unregistered`
 *  (plan delta D5) lists declared names with no registry row at all — the state a spec loaded
 *  before Phase 1 shipped is in (there is no backfill; spec §12.2 item 14), which the pane must
 *  name rather than render as "declares no resources". */
export type EnvironmentResourcesView = { workCenterId: string; resources: SharedResourceView[]; unregistered: string[] };

// ── Reads ──────────────────────────────────────────────────────────────────────────────────

/** Every registry resource of a work center, orphans included — the Shared State tab's backstop
 *  view (spec §6.4). `undefined` when the work center does not exist. */
export async function listWorkCenterResources(db: Db, workCenterId: string): Promise<SharedResourceView[] | undefined> {
  if (!(await workCenterExists(db, workCenterId))) return undefined;
  return loadResourceViews(db, workCenterId, null);
}

export async function listEnvironmentResources(db: Db, envSpecId: string): Promise<EnvironmentResourcesView | undefined> {
  const [spec] = await db.select({ workCenterId: environmentSpec.workCenterId, specJsonb: environmentSpec.specJsonb })
    .from(environmentSpec).where(eq(environmentSpec.id, envSpecId));
  if (!spec) return undefined;
  // readRegistrySource is the load path's own parser: what it would materialize is exactly what
  // this pane should show. Its warnings are the loader's concern, not a read's.
  const declared = [...new Set(readRegistrySource(spec.specJsonb).resources.map((r) => r.name))];
  const resources = declared.length === 0 ? [] : await loadResourceViews(db, spec.workCenterId, declared);
  const present = new Set(resources.map((r) => r.name));
  return { workCenterId: spec.workCenterId, resources, unregistered: declared.filter((n) => !present.has(n)) };
}

// ── Internals (exported for the instance views in this same module) ────────────────────────

export async function workCenterExists(db: Db, workCenterId: string): Promise<boolean> {
  const rows = await db.select({ id: workCenter.id }).from(workCenter).where(eq(workCenter.id, workCenterId));
  return rows.length > 0;
}

/** Rows for a work center, optionally narrowed to `names`, assembled with their holders, waiters
 *  and step names. Ordered by name. */
export async function loadResourceViews(db: Db, workCenterId: string, names: string[] | null): Promise<SharedResourceView[]> {
  const scope = names === null
    ? eq(wcResource.workCenterId, workCenterId)
    : and(eq(wcResource.workCenterId, workCenterId), inArray(wcResource.name, names));
  const rows = await db.select({ ...getTableColumns(wcResource), liveSpecName: environmentSpec.name })
    .from(wcResource)
    .leftJoin(environmentSpec, eq(environmentSpec.id, wcResource.definedByEnvSpecId))
    .where(scope)
    .orderBy(asc(wcResource.name));
  if (rows.length === 0) return [];
  const rowNames = rows.map((r) => r.name);

  const holderRows = await db.select({
    id: wcResourceHolder.id,
    name: wcResourceHolder.name, instanceId: wcResourceHolder.instanceId, stepOid: wcResourceHolder.stepOid,
    amount: wcResourceHolder.amount, heldName: wcResourceHolder.heldName, acquiredAt: wcResourceHolder.acquiredAt,
    runtimeNumber: workflowInstance.runtimeNumber, runtimeLabel: workflowInstance.runtimeLabel, masterName: workflowInstance.masterName,
  }).from(wcResourceHolder)
    .innerJoin(workflowInstance, eq(workflowInstance.id, wcResourceHolder.instanceId))
    .where(and(eq(wcResourceHolder.workCenterId, workCenterId), inArray(wcResourceHolder.name, rowNames)))
    .orderBy(asc(wcResourceHolder.id));

  const waiterRows = await db.select({
    id: wcResourceWaiter.id, name: wcResourceWaiter.name, instanceId: wcResourceWaiter.instanceId,
    stepOid: wcResourceWaiter.stepOid, kind: wcResourceWaiter.kind, amount: wcResourceWaiter.amount,
    granted: wcResourceWaiter.granted, enqueuedAt: wcResourceWaiter.enqueuedAt,
    runtimeNumber: workflowInstance.runtimeNumber, runtimeLabel: workflowInstance.runtimeLabel, masterName: workflowInstance.masterName,
  }).from(wcResourceWaiter)
    .innerJoin(workflowInstance, eq(workflowInstance.id, wcResourceWaiter.instanceId))
    .where(and(eq(wcResourceWaiter.workCenterId, workCenterId), inArray(wcResourceWaiter.name, rowNames)))
    .orderBy(asc(wcResourceWaiter.id)); // the identity column IS the FIFO order

  const stepName = await stepNameResolver(db, [...holderRows, ...waiterRows].map((r) => r.instanceId));

  return rows.map((row) => {
    const holders: SharedResourceHolder[] = holderRows.filter((h) => h.name === row.name).map((h) => ({
      id: h.id,
      instanceId: h.instanceId, runtimeNumber: h.runtimeNumber, runtimeLabel: h.runtimeLabel, masterName: h.masterName,
      stepOid: h.stepOid, stepName: stepName(h.instanceId, h.stepOid),
      amount: h.amount, heldName: h.heldName, acquiredAt: h.acquiredAt,
    }));
    const waiters: SharedResourceWaiter[] = waiterRows.filter((w) => w.name === row.name).map((w) => ({
      id: w.id, instanceId: w.instanceId, runtimeNumber: w.runtimeNumber, runtimeLabel: w.runtimeLabel, masterName: w.masterName,
      stepOid: w.stepOid, stepName: stepName(w.instanceId, w.stepOid),
      kind: w.kind as WcWaiterKind, amount: w.amount, granted: w.granted, enqueuedAt: w.enqueuedAt,
    }));
    // Queue counts exclude granted rows — a granted waiter has left the queue and its capacity
    // is already reflected in in_use, mirroring the engine's own hydration filter
    // (MissionEngine/src/core/env-resource-bridge.ts: `.filter((w) => !w.granted)`),
    // which keeps summarizeRegistryRow's counts in vocabulary parity with the engine's (spec
    // §6.1). The `waiters` LIST above still carries every row, granted included — only the
    // counts fed to the summary change.
    const queue = { acquire: 0, send: 0, receive: 0, sync: 0 };
    for (const w of waiters) if (!w.granted) queue[w.kind] += 1;
    const { unaccounted, ledgerMismatch } = accountFor(row, holders);
    const summary = summarizeRegistryRow(row, queue);
    return {
      workCenterId: row.workCenterId, name: row.name, resourceType: row.resourceType, description: row.description,
      useLimit: row.useLimit, poolNames: row.poolNames, availableNames: row.availableNames, inUse: row.inUse,
      summary,
      unaccounted, ledgerMismatch,
      // §6.3: read over-committed through the summary's resolved capacity, not the raw column
      // — summary.total already applied use_limit ?? 1 exactly once inside summarizeRegistryRow,
      // and re-checking row.useLimit !== null here would read a NULL (count-1 pool) as
      // "unlimited" instead of capacity 1. Sync's total is 0, excluded by construction.
      overCommitted: summary.total > 0 && row.inUse > summary.total,
      holders, waiters,
      definedBy: {
        envSpecId: row.definedByEnvSpecId,
        name: row.liveSpecName ?? row.definedFromName,
        version: row.definedFromVersion, state: row.definedFromState,
      },
      orphaned: row.definedByEnvSpecId === null,
      updatedAt: row.updatedAt,
    };
  });
}

/** Spec §4.1's per-type "unaccounted" figure, plus §12.1 item 7's clamp-and-badge. */
function accountFor(
  row: { resourceType: string; inUse: number; poolNames: string[]; availableNames: string[] },
  holders: { amount: number; heldName: string | null }[],
): { unaccounted: number | null; ledgerMismatch: boolean } {
  switch (row.resourceType) {
    case 'sync':
      return { unaccounted: null, ledgerMismatch: false };
    case 'named pool': {
      // Held = on the roster and not free. A RETIRED name (dropped from the roster while held,
      // spec §4.6) is in neither array, so a holder of one is neither unaccounted nor a
      // mismatch — it is simply invisible until released. A holder claiming a name that is
      // currently FREE is the mismatch.
      const attributed = new Set(holders.map((h) => h.heldName).filter((n): n is string => n !== null));
      const held = row.poolNames.filter((n) => !row.availableNames.includes(n));
      const free = new Set(row.availableNames);
      return {
        unaccounted: held.filter((n) => !attributed.has(n)).length,
        ledgerMismatch: holders.some((h) => h.heldName === null || free.has(h.heldName)),
      };
    }
    default: {
      const raw = row.inUse - holders.reduce((sum, h) => sum + h.amount, 0);
      return { unaccounted: Math.max(0, raw), ledgerMismatch: raw < 0 };
    }
  }
}

/** Step display names for holder/waiter chips. A row carries only a step oid; its name lives in
 *  the instance's frozen recipe. spec_jsonb is loaded once per instance, SERVER-SIDE ONLY, and
 *  never reaches a return value — the discipline getRuntimeWorkflowLive (dao/runtime-workflows.ts)
 *  keeps on its own 2 s poll path. */
async function stepNameResolver(db: Db, instanceIds: string[]): Promise<(instanceId: string, stepOid: string) => string | null> {
  const ids = [...new Set(instanceIds)];
  if (ids.length === 0) return () => null;
  const specs = await db.select({ id: workflowInstance.id, specJsonb: workflowInstance.specJsonb })
    .from(workflowInstance).where(inArray(workflowInstance.id, ids));
  const byId = new Map(specs.map((s) => [s.id, s.specJsonb]));
  return (instanceId, stepOid) => stepNameFromSpec(byId.get(instanceId), stepOid);
}

/** Twin of the trace-branch walk in getRuntimeWorkflowLive: every node, root and children at any
 *  depth, until a step with this oid is found. Exported for the instance views (Task 3). */
export function stepNameFromSpec(spec: unknown, stepOid: string): string | null {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return null;
  const s = spec as Record<string, unknown>;
  if (Array.isArray(s.steps)) {
    const hit = (s.steps as Array<Record<string, unknown>>).find((st) => st?.oid === stepOid);
    if (hit && typeof hit.local_id === 'string') return hit.local_id;
  }
  if (Array.isArray(s.children)) {
    for (const c of s.children) { const n = stepNameFromSpec(c, stepOid); if (n) return n; }
  }
  return null;
}

// ── Value properties ───────────────────────────────────────────────────────────────────────

/** The engine excludes an entry named "Description" (case-insensitive) from group reads —
 *  properties.ts resolvePropertyKey and shared-properties.ts entriesUnder — because value
 *  properties use it for human annotation, never runtime data (spec §5.6). The pane shows it
 *  but must label it, so the rule is applied here, server-side, with the engine's spelling. */
export function isAnnotationEntry(entryName: string): boolean {
  return entryName.toLowerCase() === 'description';
}

export type SharedValuePropertyView = {
  workCenterId: string; propertyName: string; entryName: string; value: string;
  annotation: boolean;
  definedByEnvSpecId: string | null; orphaned: boolean;
  updatedAt: Date;
  /** NULL when the engine wrote it — updated_by is only ever set by a commander's CM edit
   *  (Phase 4). */
  updatedByName: string | null;
};

export type EnvironmentValuePropertiesView = {
  workCenterId: string; values: SharedValuePropertyView[];
  unregistered: { propertyName: string; entryName: string }[];
};

export async function listWorkCenterValueProperties(db: Db, workCenterId: string): Promise<SharedValuePropertyView[] | undefined> {
  if (!(await workCenterExists(db, workCenterId))) return undefined;
  return loadValueViews(db, workCenterId, null);
}

export async function listEnvironmentValueProperties(db: Db, envSpecId: string): Promise<EnvironmentValuePropertiesView | undefined> {
  const [spec] = await db.select({ workCenterId: environmentSpec.workCenterId, specJsonb: environmentSpec.specJsonb })
    .from(environmentSpec).where(eq(environmentSpec.id, envSpecId));
  if (!spec) return undefined;
  const declared = readRegistrySource(spec.specJsonb).valueProperties;
  const names = [...new Set(declared.map((p) => p.name))];
  // Filtered by PROPERTY name: the namespace is flat (U2), so every entry under a property this
  // spec declares belongs in its pane, whichever spec added the entry.
  const values = names.length === 0 ? [] : await loadValueViews(db, spec.workCenterId, names);
  const present = new Set(values.map((v) => JSON.stringify([v.propertyName, v.entryName])));
  // readRegistrySource's value-property gate (valuePropertyShapeProblem) checks only that
  // `name` is a string — `entries` and an entry's `name` are still untrusted jsonb here, same
  // as the write path (materializeEnvironmentRegistry) guards twice. A malformed declaration
  // must contribute nothing rather than throw (spec: conflicts warn, never fail — the read
  // path is at least as tolerant as the write path). Declared pairs are also deduped: a spec
  // that repeats the same property name must not emit the same missing entry twice.
  const unregisteredPairs = declared.flatMap((p) => (Array.isArray(p.entries) ? p.entries : [])
    .filter((e) => typeof e?.name === 'string' && !present.has(JSON.stringify([p.name, e.name])))
    .map((e) => ({ propertyName: p.name, entryName: e.name as string })));
  const unregistered = [...new Map(unregisteredPairs.map((u) => [JSON.stringify([u.propertyName, u.entryName]), u])).values()];
  return { workCenterId: spec.workCenterId, values, unregistered };
}

async function loadValueViews(db: Db, workCenterId: string, propertyNames: string[] | null): Promise<SharedValuePropertyView[]> {
  const scope = propertyNames === null
    ? eq(wcValueProperty.workCenterId, workCenterId)
    : and(eq(wcValueProperty.workCenterId, workCenterId), inArray(wcValueProperty.propertyName, propertyNames));
  const rows = await db.select({
    workCenterId: wcValueProperty.workCenterId, propertyName: wcValueProperty.propertyName, entryName: wcValueProperty.entryName,
    value: wcValueProperty.value, definedByEnvSpecId: wcValueProperty.definedByEnvSpecId,
    updatedAt: wcValueProperty.updatedAt, updatedByName: appUser.displayName,
  }).from(wcValueProperty)
    .leftJoin(appUser, eq(appUser.id, wcValueProperty.updatedBy))
    .where(scope)
    .orderBy(asc(wcValueProperty.propertyName), asc(wcValueProperty.entryName));
  return rows.map((r) => ({ ...r, annotation: isAnnotationEntry(r.entryName), orphaned: r.definedByEnvSpecId === null }));
}

// ── Runtime workflow (instance) views ──────────────────────────────────────────────────────

/** Mirrors SerializedResourceState in MissionEngine/src/core/resources.ts — the engine
 *  is the source of truth for this shape (inline structural type, the same trick
 *  getRuntimeWorkflowLiveStates uses for childActive, because this package cannot import the
 *  engine). Every field is optional so a shape drift degrades to zeros on the 2 s poll path
 *  rather than crashing it. */
type SerializedResourceEntry = {
  type?: string; ownerId?: string; scope?: 'workflow' | 'environment';
  inUse?: number; useLimit?: number;
  queue?: Array<string | { stepOid?: string; amount?: number }>;
  available?: string[]; originalNames?: string[];
  sendQueue?: Array<{ stepOid?: string; data?: string }>; receiveQueue?: string[]; pendingSync?: string[];
};
type SerializedResourcesShape = { resources?: Array<[string, SerializedResourceEntry]> } | null | undefined;

export type WorkflowResourceView = {
  key: string; ownerOid: string; name: string; resourceType: string;
  summary: ResourceSummary;
  /** This instance's own queued steps on the pool, in queue order. */
  queuedSteps: { stepOid: string; stepName: string | null; kind: WcWaiterKind }[];
};

export type InstanceResourcesView = {
  instanceId: string; runtimeNumber: number; runtimeLabel: string; masterName: string;
  /** Workflow-scoped pools, projected from engine_state.resources. */
  workflow: WorkflowResourceView[];
  /** Every environment resource this instance holds or waits on — the same rows the Environment
   *  pane shows, so the contention picture is complete here too (spec §6.5). */
  environment: SharedResourceView[];
};

export async function listInstanceResources(db: Db, instanceId: string): Promise<InstanceResourcesView | undefined> {
  const [inst] = await db.select({
    id: workflowInstance.id, workCenterId: workflowInstance.workCenterId, runtimeNumber: workflowInstance.runtimeNumber,
    runtimeLabel: workflowInstance.runtimeLabel,
    masterName: workflowInstance.masterName, engineState: workflowInstance.engineState, specJsonb: workflowInstance.specJsonb,
  }).from(workflowInstance).where(eq(workflowInstance.id, instanceId));
  if (!inst) return undefined;

  const rawEntries = (inst.engineState as { resources?: SerializedResourcesShape } | null)?.resources?.resources ?? [];
  const entries = Array.isArray(rawEntries) ? rawEntries : [];
  const workflowScoped: WorkflowResourceView[] = [];
  for (const entry of entries) {
    // A shape drift (a non-tuple entry, or a tuple with no resource payload) skips the entry
    // rather than throwing on the 2 s poll path — the degrade-to-zeros promise above.
    if (!Array.isArray(entry) || !entry[1]) continue;
    const [key, r] = entry;
    // A pre-cutover instance can still carry environment entries until its first hydrate folds
    // them out (spec §5.7); the registry is their home, not this list.
    if (r.scope === 'environment') continue;
    const view = projectWorkflowResource(key, r, inst.specJsonb);
    if (view) workflowScoped.push(view);
  }
  workflowScoped.sort((a, b) => a.name.localeCompare(b.name) || a.ownerOid.localeCompare(b.ownerOid));

  const held = await db.select({ name: wcResourceHolder.name }).from(wcResourceHolder).where(eq(wcResourceHolder.instanceId, instanceId));
  const waiting = await db.select({ name: wcResourceWaiter.name }).from(wcResourceWaiter).where(eq(wcResourceWaiter.instanceId, instanceId));
  const envNames = [...new Set([...held, ...waiting].map((r) => r.name))];
  const environment = envNames.length === 0 ? [] : await loadResourceViews(db, inst.workCenterId, envNames);

  return { instanceId: inst.id, runtimeNumber: inst.runtimeNumber, runtimeLabel: inst.runtimeLabel, masterName: inst.masterName, workflow: workflowScoped, environment };
}

function projectWorkflowResource(key: string, r: SerializedResourceEntry, spec: unknown): WorkflowResourceView | null {
  const ownerOid = r.ownerId ?? '';
  const prefix = `${ownerOid}:`;
  const name = key.startsWith(prefix) ? key.substring(prefix.length) : key;
  const stepOf = (q: string | { stepOid?: string }) => (typeof q === 'string' ? q : (q.stepOid ?? ''));
  const queued = (oids: string[], kind: WcWaiterKind) => oids.map((stepOid) => ({ stepOid, stepName: stepNameFromSpec(spec, stepOid), kind }));
  const type = r.type ?? '';
  let summary: ResourceSummary;
  let queuedSteps: WorkflowResourceView['queuedSteps'];
  switch (type) {
    case 'binary exclusive use':
      summary = summarizeResource({ type, inUse: r.inUse ?? 0, queued: r.queue?.length ?? 0 });
      queuedSteps = queued((r.queue ?? []).map(stepOf), 'acquire');
      break;
    case 'binary shared use with pool limits':
    case 'countable use with pool limits':
      summary = summarizeResource({ type, inUse: r.inUse ?? 0, useLimit: r.useLimit ?? 1, queued: r.queue?.length ?? 0 });
      queuedSteps = queued((r.queue ?? []).map(stepOf), 'acquire');
      break;
    case 'named pool':
      summary = summarizeResource({ type, poolSize: r.originalNames?.length ?? 0, available: r.available?.length ?? 0, queued: r.queue?.length ?? 0 });
      queuedSteps = queued((r.queue ?? []).map(stepOf), 'acquire');
      break;
    case 'sync':
      summary = summarizeResource({ type, send: r.sendQueue?.length ?? 0, receive: r.receiveQueue?.length ?? 0, sync: r.pendingSync?.length ?? 0 });
      queuedSteps = [
        ...queued((r.sendQueue ?? []).map((s) => s.stepOid ?? ''), 'send'),
        ...queued(r.receiveQueue ?? [], 'receive'),
        ...queued(r.pendingSync ?? [], 'sync'),
      ];
      break;
    default:
      return null; // an unknown shape is skipped rather than crashing the poll
  }
  return { key, ownerOid, name, resourceType: type, summary, queuedSteps };
}

export type InstanceValuePropertiesView = {
  instanceId: string;
  /** The root spec's own store (workflow_instance.property_store), keyed "Property.Entry". */
  root: Record<string, string>;
  /** Each child spec with its own store in engine_state.childProperties (keyed by child spec
   *  oid), named from the frozen recipe. */
  children: { childOid: string; childName: string | null; values: Record<string, string> }[];
  /** The shared environment values this instance can see — the whole work-center registry,
   *  because hydration loads every row (spec §5.6). */
  shared: SharedValuePropertyView[];
};

export async function listInstanceValueProperties(db: Db, instanceId: string): Promise<InstanceValuePropertiesView | undefined> {
  const [inst] = await db.select({
    id: workflowInstance.id, workCenterId: workflowInstance.workCenterId,
    propertyStore: workflowInstance.propertyStore, engineState: workflowInstance.engineState, specJsonb: workflowInstance.specJsonb,
  }).from(workflowInstance).where(eq(workflowInstance.id, instanceId));
  if (!inst) return undefined;
  const root = asFlatMap(inst.propertyStore);
  // engine_state.childProperties: Record<childSpecOid, Record<key, value>> — the engine's
  // engine-state.ts is the source of truth for the shape. Object.entries() below reads back
  // Postgres's jsonb key order (sorted by length, then bytes) — NOT insertion/activation order;
  // jsonb does not preserve key order. Spec §6.5 imposes no ordering requirement on children.
  const childProps = (inst.engineState as { childProperties?: Record<string, unknown> } | null)?.childProperties ?? {};
  const children = Object.entries(childProps).map(([childOid, values]) => ({
    childOid, childName: childNameFromSpec(inst.specJsonb, childOid), values: asFlatMap(values),
  }));
  const shared = await loadValueViews(db, inst.workCenterId, null);
  return { instanceId: inst.id, root, children, shared };
}

function asFlatMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (typeof v === 'string') out[k] = v;
  return out;
}

/** Child spec display name: walk `children[]` at every depth for the child whose oid matches. */
export function childNameFromSpec(spec: unknown, childOid: string): string | null {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return null;
  const s = spec as Record<string, unknown>;
  if (!Array.isArray(s.children)) return null;
  for (const c of s.children as Array<Record<string, unknown>>) {
    if (c?.oid === childOid) return typeof c.local_id === 'string' ? c.local_id : null;
    const deeper = childNameFromSpec(c, childOid);
    if (deeper) return deeper;
  }
  return null;
}
