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

// Master Schedule storage (spec 2026-11-08 §5.3). A Master refers to workflows by name
// (no FK), so deleting a workflow never blocks on a schedule.

import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { Schema } from '../db/client.js';
import { apiClient, masterSchedule, masterScheduleItem, runtimeScheduleEvent, type MasterSchedule, type MasterScheduleItem } from '../db/schema/index.js';
import { DaoError, pgErrorCode, pgViolates } from '../dao/errors.js';
import { LONE_SURROGATE, parseScheduleDefinition, type ScheduleDefinition, type ScheduleItemInput } from './definition.js';
import { describeRecurrence, type Recurrence } from './recurrence.js';
import type { ValueSource } from './values.js';
import { appendScheduleEvent, type ScheduleActor } from './events.js';

type Db = PgDatabase<any, Schema>;

export type MasterScheduleView = ScheduleDefinition & {
  id: string;
  workCenterId: string;
  source: 'commander' | 'api';
  externalKey: string | null;
  revision: number;
  recurrenceText: string;
  updatedAt: Date;
  /** Name of the API client that last wrote it ("Managed by ERP Scheduler"); null for a Commander write. */
  managedBy: string | null;
};

/** Names of the API clients behind the given ids; a deleted client is simply absent. */
async function clientNames(db: Db, ids: (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((i): i is string => i !== null))];
  if (wanted.length === 0) return new Map();
  const rows = await db.select({ id: apiClient.id, name: apiClient.name }).from(apiClient).where(inArray(apiClient.id, wanted));
  return new Map(rows.map((r) => [r.id, r.name]));
}

function parseOrThrow(input: unknown): ScheduleDefinition {
  const r = parseScheduleDefinition(input);
  if (!r.ok) throw new DaoError('MASTER_SCHEDULE_INVALID', 'The schedule is not valid', r.problems);
  return r.value;
}

/** Key-sorted JSON, so equal definitions compare equal whatever their key order. */
function canonical(v: unknown): string {
  const sort = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sort);
    if (x && typeof x === 'object') {
      return Object.fromEntries(Object.entries(x as Record<string, unknown>)
        .filter(([, val]) => val !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, val]) => [k, sort(val)]));
    }
    return x;
  };
  return JSON.stringify(sort(v));
}

/** What a Runtime records at Enable and a re-send compares to: equal content gives an equal hash. */
export function definitionHash(def: ScheduleDefinition): string {
  return createHash('sha256').update(canonical(def)).digest('hex');
}

const userId = (a: ScheduleActor) => (a.kind === 'user' ? a.userId : null);
const clientId = (a: ScheduleActor) => (a.kind === 'api_client' ? a.clientId : null);

function buildView(row: MasterSchedule, items: MasterScheduleItem[], names: Map<string, string>): MasterScheduleView {
  const children = new Map<string | null, MasterScheduleItem[]>();
  for (const it of items) {
    const list = children.get(it.parentItemId) ?? [];
    list.push(it);
    children.set(it.parentItemId, list);
  }
  const build = (parent: string | null): ScheduleItemInput[] =>
    (children.get(parent) ?? []).sort((a, b) => a.position - b.position).map((it) => {
      const out: ScheduleItemInput = {
        workflow: it.workflowVersion === null ? { name: it.workflowName } : { name: it.workflowName, version: it.workflowVersion },
      };
      if (it.triggerOn !== null) out.triggerOn = it.triggerOn;
      if (it.params !== null) out.params = it.params as Record<string, ValueSource>;
      const chain = build(it.id);
      if (chain.length > 0) out.chain = chain;
      return out;
    });
  const recurrence = row.recurrence as Recurrence;
  const view: MasterScheduleView = {
    id: row.id,
    workCenterId: row.workCenterId,
    name: row.name,
    recurrence,
    items: build(null),
    source: row.source as 'commander' | 'api',
    externalKey: row.externalKey,
    revision: row.revision,
    recurrenceText: describeRecurrence(recurrence),
    updatedAt: row.updatedAt,
    managedBy: row.updatedByClient ? names.get(row.updatedByClient) ?? null : null,
  };
  if (row.description !== null) view.description = row.description;
  return view;
}

async function loadView(db: Db, id: string): Promise<MasterScheduleView | undefined> {
  const [row] = await db.select().from(masterSchedule).where(eq(masterSchedule.id, id));
  if (!row) return undefined;
  const items = await db.select().from(masterScheduleItem)
    .where(eq(masterScheduleItem.masterScheduleId, id)).orderBy(asc(masterScheduleItem.position));
  return buildView(row, items, await clientNames(db, [row.updatedByClient]));
}

async function insertItems(tx: Db, masterId: string, list: ScheduleItemInput[], parent: string | null): Promise<void> {
  for (const [position, it] of list.entries()) {
    const [row] = await tx.insert(masterScheduleItem).values({
      masterScheduleId: masterId,
      parentItemId: parent,
      position,
      workflowName: it.workflow.name,
      workflowVersion: it.workflow.version ?? null,
      triggerOn: it.triggerOn ?? null,
      params: it.params ?? null,
    }).returning({ id: masterScheduleItem.id });
    if (it.chain?.length) await insertItems(tx, masterId, it.chain, row!.id);
  }
}

/** Maps the unique-name violation and a missing work center to typed errors. */
function mapWriteError(err: unknown): never {
  if (err instanceof DaoError) throw err;
  if (pgViolates(err, 'master_schedule_wc_name_uq')) throw new DaoError('MASTER_SCHEDULE_NAME_CONFLICT', 'A Master Schedule with that name already exists here');
  if (pgErrorCode(err) === '23503') throw new DaoError('WORK_CENTER_NOT_FOUND');
  throw err;
}

/** Why a Master was saved, for its change history. Refuses what the audit log cannot store. */
export function checkChangeReason(reason: string | undefined): string | null {
  if (reason === undefined) return null;
  const why = reason.trim();
  if (why === '') throw new DaoError('CONFIRMATION_REQUIRED', 'A reason for the change is required');
  if (why.length > 2000) throw new DaoError('CONFIRMATION_REQUIRED', 'The reason is over 2000 characters');
  if (why.includes('\0')) throw new DaoError('CONFIRMATION_REQUIRED', 'The reason cannot contain the NUL character (\\u0000)');
  if (LONE_SURROGATE.test(why)) throw new DaoError('CONFIRMATION_REQUIRED', 'The reason cannot contain half of a Unicode character');
  return why;
}

async function insertMaster(
  tx: Db, workCenterId: string, def: ScheduleDefinition, actor: ScheduleActor,
  source: 'commander' | 'api', externalKey: string | null, reason: string | null,
): Promise<string> {
  const [row] = await tx.insert(masterSchedule).values({
    workCenterId, name: def.name, description: def.description ?? null, recurrence: def.recurrence,
    source, externalKey, createdBy: userId(actor), updatedBy: userId(actor), updatedByClient: clientId(actor),
  }).returning({ id: masterSchedule.id });
  const id = row!.id;
  await insertItems(tx, id, def.items, null);
  await appendScheduleEvent(tx, { runtimeScheduleId: null, masterScheduleId: id, action: 'master_created', actor, detail: { name: def.name, revision: 1, reason } });
  return id;
}

/** Rewrites content and bumps the revision. Does not touch source or externalKey. */
async function rewriteMaster(tx: Db, id: string, def: ScheduleDefinition, actor: ScheduleActor, reason: string | null): Promise<number> {
  const [row] = await tx.update(masterSchedule).set({
    name: def.name, description: def.description ?? null, recurrence: def.recurrence,
    revision: sql`${masterSchedule.revision} + 1`,
    updatedBy: userId(actor), updatedByClient: clientId(actor), updatedAt: new Date(),
  }).where(eq(masterSchedule.id, id)).returning({ revision: masterSchedule.revision });
  const revision = row!.revision;
  await tx.delete(masterScheduleItem).where(eq(masterScheduleItem.masterScheduleId, id));
  await insertItems(tx, id, def.items, null);
  await appendScheduleEvent(tx, { runtimeScheduleId: null, masterScheduleId: id, action: 'master_updated', actor, detail: { name: def.name, revision, reason } });
  return revision;
}

export function definitionOf(v: MasterScheduleView): ScheduleDefinition {
  const d: ScheduleDefinition = { name: v.name, recurrence: v.recurrence, items: v.items };
  if (v.description !== undefined) d.description = v.description;
  return d;
}

export async function createMasterSchedule(
  db: Db, workCenterId: string, input: unknown, actor: ScheduleActor, reason?: string,
): Promise<MasterScheduleView> {
  const def = parseOrThrow(input);
  const why = checkChangeReason(reason);
  try {
    // Called with an open transaction (a package import), this is a savepoint: a refused insert leaves the caller's transaction usable.
    const id = await db.transaction((tx) =>
      insertMaster(tx as unknown as Db, workCenterId, def, actor, actor.kind === 'api_client' ? 'api' : 'commander', null, why));
    return (await loadView(db, id))!;
  } catch (err) {
    return mapWriteError(err);
  }
}

/** An unchanged body changes nothing: no new version, and nothing in the change history. */
export async function replaceMasterSchedule(
  db: Db, id: string, input: unknown, actor: ScheduleActor, reason?: string,
): Promise<MasterScheduleView> {
  const def = parseOrThrow(input);
  const why = checkChangeReason(reason);
  try {
    await db.transaction(async (t) => {
      const tx = t as unknown as Db;
      const current = await loadView(tx, id);
      if (!current) throw new DaoError('MASTER_SCHEDULE_NOT_FOUND');
      if (canonical(definitionOf(current)) === canonical(def)) return;
      await rewriteMaster(tx, id, def, actor, why);
    });
    return (await loadView(db, id))!;
  } catch (err) {
    return mapWriteError(err);
  }
}

const SENT_BY_REST = 'Sent through the REST interface';
export const IMPORTED_FROM_PACKAGE = 'Imported from a work-center package';

export type MasterScheduleChange = {
  version: number; at: Date; actorKind: 'user' | 'api_client' | 'system'; actorName: string | null; reason: string | null;
};

/** Every saved version of a Master, oldest first: when, who and why. A save from before reasons were
 *  asked for has none. Read from the audit log, so it outlives an edit and a delete of the Master. */
export async function listMasterScheduleChanges(db: Db, masterId: string): Promise<MasterScheduleChange[]> {
  const rows = await db.select().from(runtimeScheduleEvent).where(and(
    eq(runtimeScheduleEvent.masterScheduleId, masterId),
    inArray(runtimeScheduleEvent.action, ['master_created', 'master_updated']),
  )).orderBy(asc(runtimeScheduleEvent.at), asc(runtimeScheduleEvent.id));
  return rows.map((r, i) => {
    const d = (r.detail ?? {}) as { revision?: unknown; reason?: unknown };
    return {
      version: typeof d.revision === 'number' ? d.revision : r.action === 'master_created' ? 1 : i + 1,
      at: r.at, actorKind: r.actorKind as MasterScheduleChange['actorKind'], actorName: r.actorName,
      reason: typeof d.reason === 'string' ? d.reason : null,
    };
  });
}

export async function upsertMasterScheduleByKey(
  db: Db, workCenterId: string, externalKey: string, input: unknown, actor: ScheduleActor,
): Promise<{ master: MasterScheduleView; created: boolean; changed: boolean; definitionHash: string }> {
  const def = parseOrThrow(input);
  try {
    const saved = await db.transaction(async (t) => {
      const tx = t as unknown as Db;
      const [existing] = await tx.select({ id: masterSchedule.id }).from(masterSchedule)
        .where(and(eq(masterSchedule.workCenterId, workCenterId), eq(masterSchedule.externalKey, externalKey)));
      if (!existing) {
        const id = await insertMaster(tx, workCenterId, def, actor, 'api', externalKey, SENT_BY_REST);
        return { master: (await loadView(tx, id))!, created: true, changed: true };
      }
      const current = (await loadView(tx, existing.id))!;
      if (canonical(definitionOf(current)) === canonical(def)) return { master: current, created: false, changed: false };
      await rewriteMaster(tx, existing.id, def, actor, SENT_BY_REST);
      return { master: (await loadView(tx, existing.id))!, created: false, changed: true };
    });
    // The stored form, as Enable hashes it: an identical retry must match even if storing changed the text.
    return { ...saved, definitionHash: definitionHash(definitionOf(saved.master)) };
  } catch (err) {
    return mapWriteError(err);
  }
}

/** The definition hash of each Master that still exists, comparable to a Runtime's `definition_hash`. */
export async function masterDefinitionHashes(db: Db, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select().from(masterSchedule).where(inArray(masterSchedule.id, ids));
  const items = await db.select().from(masterScheduleItem).where(inArray(masterScheduleItem.masterScheduleId, ids));
  return new Map(rows.map((r) => {
    const own = items.filter((i) => i.masterScheduleId === r.id);
    return [r.id, definitionHash(definitionOf(buildView(r, own, new Map())))];
  }));
}

export function getMasterSchedule(db: Db, id: string): Promise<MasterScheduleView | undefined> {
  return loadView(db, id);
}

export async function listMasterSchedules(db: Db, workCenterId: string): Promise<MasterScheduleView[]> {
  const rows = await db.select().from(masterSchedule)
    .where(eq(masterSchedule.workCenterId, workCenterId)).orderBy(asc(masterSchedule.name));
  if (rows.length === 0) return [];
  const items = await db.select({ item: masterScheduleItem }).from(masterScheduleItem)
    .innerJoin(masterSchedule, eq(masterSchedule.id, masterScheduleItem.masterScheduleId))
    .where(eq(masterSchedule.workCenterId, workCenterId));
  const names = await clientNames(db, rows.map((r) => r.updatedByClient));
  return rows.map((r) => buildView(r, items.map((x) => x.item).filter((i) => i.masterScheduleId === r.id), names));
}

export async function deleteMasterSchedule(db: Db, id: string, actor: ScheduleActor): Promise<void> {
  await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const [row] = await tx.delete(masterSchedule).where(eq(masterSchedule.id, id)).returning({ name: masterSchedule.name });
    if (!row) throw new DaoError('MASTER_SCHEDULE_NOT_FOUND');
    await appendScheduleEvent(tx, { runtimeScheduleId: null, masterScheduleId: id, action: 'master_deleted', actor, detail: { name: row.name } });
  });
}
