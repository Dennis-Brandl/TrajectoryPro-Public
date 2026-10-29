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

import { expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestDb } from '../../test/helpers/db.js';
import { workCenter, runtimeHistory, appUser, type NewRuntimeHistory } from '../db/schema/index.js';
import { writeRuntimeHistory } from '../runtime/engine-access.js';
import { insertStepRun, listStepRuns } from './step-runs.js';
import {
  listRuntimeHistoryPage, getRuntimeHistoryDetail, deleteRuntimeHistory,
  countRuntimeHistoryBefore, purgeRuntimeHistory, historyRowGate,
  RUNTIME_HISTORY_MAX_PAGE_SIZE,
} from './runtime-history.js';
import { insertStepSignature, listStepSignatures } from './step-signatures.js';
import { DaoError } from './errors.js';

const NIL = '00000000-0000-0000-0000-000000000000';

async function seedWc(db: any, name = `WC-${Math.random()}`) {
  const [wc] = await db.insert(workCenter).values({ name }).returning();
  return wc;
}

async function seedHistory(db: any, overrides: Partial<NewRuntimeHistory> = {}) {
  const [row] = await db.insert(runtimeHistory).values({
    workCenterName: 'WC', runtimeNumber: 1, runtimeLabel: 'RW-1',
    masterName: 'WF', masterOid: 'wf-1', masterVersion: '1.0.0', masterState: 'Effective',
    finalState: 'completed', finishedAt: new Date(), trace: [],
    ...overrides,
  }).returning();
  return row;
}

async function expectDaoError(p: Promise<unknown>, code: string): Promise<void> {
  try {
    await p;
    expect.fail(`expected DaoError ${code}`);
  } catch (err) {
    expect(err).toBeInstanceOf(DaoError);
    expect((err as DaoError).code).toBe(code);
  }
}

test('listRuntimeHistoryPage: workCenterId filter alone', async () => {
  const { db, close } = await makeTestDb();
  const a = await seedWc(db);
  const b = await seedWc(db);
  await seedHistory(db, { workCenterId: a.id, workCenterName: a.name, finishedAt: new Date('2026-01-01') });
  await seedHistory(db, { workCenterId: b.id, workCenterName: b.name, finishedAt: new Date('2026-01-02') });

  const { items, total } = await listRuntimeHistoryPage(db, { workCenterId: a.id });
  expect(total).toBe(1);
  expect(items).toHaveLength(1);
  expect(items[0].workCenterId).toBe(a.id);

  await close();
});

test('listRuntimeHistoryPage: orphansOnly filter alone', async () => {
  const { db, close } = await makeTestDb();
  const a = await seedWc(db);
  await seedHistory(db, { workCenterId: a.id, workCenterName: a.name });
  await seedHistory(db, { workCenterId: null, workCenterName: '(deleted)' });

  const { items, total } = await listRuntimeHistoryPage(db, { orphansOnly: true });
  expect(total).toBe(1);
  expect(items[0].workCenterId).toBeNull();
  expect(items[0].workCenterName).toBe('(deleted)');

  await close();
});

test('listRuntimeHistoryPage: finalState filter alone', async () => {
  const { db, close } = await makeTestDb();
  await seedHistory(db, { finalState: 'completed' });
  await seedHistory(db, { finalState: 'errored' });
  await seedHistory(db, { finalState: 'aborted' });

  const { items, total } = await listRuntimeHistoryPage(db, { finalState: 'errored' });
  expect(total).toBe(1);
  expect(items[0].finalState).toBe('errored');

  await close();
});

test('listRuntimeHistoryPage: nameSearch filter alone (case-insensitive substring)', async () => {
  const { db, close } = await makeTestDb();
  await seedHistory(db, { masterName: 'Fuel Check' });
  await seedHistory(db, { masterName: 'Cargo Manifest' });

  const { items, total } = await listRuntimeHistoryPage(db, { nameSearch: 'fuel' });
  expect(total).toBe(1);
  expect(items[0].masterName).toBe('Fuel Check');

  await close();
});

test('listRuntimeHistoryPage: nameSearch escapes a literal % in the search term', async () => {
  const { db, close } = await makeTestDb();
  await seedHistory(db, { masterName: '50% Done' });
  await seedHistory(db, { masterName: '5000 Done' });

  // Unescaped, '%' would ILIKE-match everything ("%%%" == wildcard-wildcard-wildcard).
  // Escaped, it must match ONLY the row with a literal percent character.
  const { items, total } = await listRuntimeHistoryPage(db, { nameSearch: '%' });
  expect(total).toBe(1);
  expect(items[0].masterName).toBe('50% Done');

  await close();
});

test('listRuntimeHistoryPage: nameSearch escapes _ and \\ too', async () => {
  const { db, close } = await makeTestDb();
  await seedHistory(db, { masterName: 'a_b' });
  await seedHistory(db, { masterName: 'axb' });
  await seedHistory(db, { masterName: 'c\\d' });
  await seedHistory(db, { masterName: 'cxd' });

  const underscoreHit = await listRuntimeHistoryPage(db, { nameSearch: 'a_b' });
  expect(underscoreHit.total).toBe(1);
  expect(underscoreHit.items[0].masterName).toBe('a_b');

  const backslashHit = await listRuntimeHistoryPage(db, { nameSearch: 'c\\d' });
  expect(backslashHit.total).toBe(1);
  expect(backslashHit.items[0].masterName).toBe('c\\d');

  await close();
});

test('listRuntimeHistoryPage: finishedFrom/finishedTo filters alone', async () => {
  const { db, close } = await makeTestDb();
  await seedHistory(db, { finishedAt: new Date('2026-01-01T00:00:00Z') });
  await seedHistory(db, { finishedAt: new Date('2026-02-01T00:00:00Z') });
  await seedHistory(db, { finishedAt: new Date('2026-03-01T00:00:00Z') });

  const fromOnly = await listRuntimeHistoryPage(db, { finishedFrom: new Date('2026-02-01T00:00:00Z') });
  expect(fromOnly.total).toBe(2);

  const toOnly = await listRuntimeHistoryPage(db, { finishedTo: new Date('2026-02-01T00:00:00Z') });
  expect(toOnly.total).toBe(2);

  const range = await listRuntimeHistoryPage(db, {
    finishedFrom: new Date('2026-01-15T00:00:00Z'), finishedTo: new Date('2026-02-15T00:00:00Z'),
  });
  expect(range.total).toBe(1);

  await close();
});

test('listRuntimeHistoryPage: combined filters (workCenterId + finalState + nameSearch + date range)', async () => {
  const { db, close } = await makeTestDb();
  const a = await seedWc(db);
  const b = await seedWc(db);

  // Matches every filter.
  await seedHistory(db, {
    workCenterId: a.id, workCenterName: a.name, finalState: 'errored', masterName: 'Fuel Check',
    finishedAt: new Date('2026-02-01T00:00:00Z'),
  });
  // Wrong work center.
  await seedHistory(db, {
    workCenterId: b.id, workCenterName: b.name, finalState: 'errored', masterName: 'Fuel Check',
    finishedAt: new Date('2026-02-01T00:00:00Z'),
  });
  // Wrong final state.
  await seedHistory(db, {
    workCenterId: a.id, workCenterName: a.name, finalState: 'completed', masterName: 'Fuel Check',
    finishedAt: new Date('2026-02-01T00:00:00Z'),
  });
  // Wrong name.
  await seedHistory(db, {
    workCenterId: a.id, workCenterName: a.name, finalState: 'errored', masterName: 'Cargo Manifest',
    finishedAt: new Date('2026-02-01T00:00:00Z'),
  });
  // Out of date range.
  await seedHistory(db, {
    workCenterId: a.id, workCenterName: a.name, finalState: 'errored', masterName: 'Fuel Check',
    finishedAt: new Date('2026-06-01T00:00:00Z'),
  });

  const { items, total } = await listRuntimeHistoryPage(db, {
    workCenterId: a.id, finalState: 'errored', nameSearch: 'fuel',
    finishedFrom: new Date('2026-01-01T00:00:00Z'), finishedTo: new Date('2026-03-01T00:00:00Z'),
  });
  expect(total).toBe(1);
  expect(items[0].masterName).toBe('Fuel Check');
  expect(items[0].workCenterId).toBe(a.id);

  await close();
});

test('listRuntimeHistoryPage: workCenterId + orphansOnly together throws HISTORY_FILTER_INVALID', async () => {
  const { db, close } = await makeTestDb();
  const a = await seedWc(db);

  await expectDaoError(
    listRuntimeHistoryPage(db, { workCenterId: a.id, orphansOnly: true }),
    'HISTORY_FILTER_INVALID',
  );

  await close();
});

test('listRuntimeHistoryPage: pagination + total, ordered finished_at DESC', async () => {
  const { db, close } = await makeTestDb();
  for (let i = 1; i <= 5; i++) {
    await seedHistory(db, { runtimeNumber: i, finishedAt: new Date(2026, 0, i) });
  }

  const all = await listRuntimeHistoryPage(db, {});
  expect(all.total).toBe(5);
  expect(all.items.map((i) => i.runtimeNumber)).toEqual([5, 4, 3, 2, 1]);
  expect(all.page).toBe(1);
  expect(all.pageSize).toBe(50);

  const page2 = await listRuntimeHistoryPage(db, { page: 2, pageSize: 2 });
  expect(page2.items.map((i) => i.runtimeNumber)).toEqual([3, 2]);
  expect(page2.total).toBe(5);

  await close();
});

test('listRuntimeHistoryPage: clamps pageSize to 200 max and NaN-proofs page/pageSize', async () => {
  const { db, close } = await makeTestDb();
  for (let i = 1; i <= 3; i++) {
    await seedHistory(db, { runtimeNumber: i, finishedAt: new Date(2026, 0, i) });
  }

  const capped = await listRuntimeHistoryPage(db, { pageSize: 5000 });
  expect(capped.pageSize).toBe(RUNTIME_HISTORY_MAX_PAGE_SIZE);

  const nanClamped = await listRuntimeHistoryPage(db, { page: NaN, pageSize: NaN });
  expect(nanClamped.page).toBe(1);
  expect(nanClamped.pageSize).toBe(50);
  expect(nanClamped.items).toHaveLength(3);

  const zeroOrNegative = await listRuntimeHistoryPage(db, { page: -5, pageSize: 0 });
  expect(zeroOrNegative.page).toBe(1);
  expect(zeroOrNegative.pageSize).toBe(1);

  await close();
});

test('listRuntimeHistoryPage: summary carries no trace/properties/step_params/starting_params/step_names keys', async () => {
  const { db, close } = await makeTestDb();
  await seedHistory(db, {
    trace: [{ step_oid: 's-1', state: 'completed', order: 0, timestamp: 1 }],
    startingParams: { a: 'b' }, properties: { c: 'd' }, stepParams: { e: 'f' }, stepNames: { 's-1': 'Start' },
  });

  const { items } = await listRuntimeHistoryPage(db, {});
  expect(items).toHaveLength(1);
  const keys = Object.keys(items[0]).sort();
  expect(keys).toEqual([
    'createdAt', 'finalState', 'finishedAt', 'id', 'masterName', 'masterOid', 'masterState', 'masterVersion',
    'runtimeLabel', 'runtimeNumber', 'startedAt', 'workCenterId', 'workCenterName', 'workflowInstanceId',
  ]);

  await close();
});

test('getRuntimeHistoryDetail: full payload incl. stepNames; undefined for unknown id', async () => {
  const { db, close } = await makeTestDb();
  const a = await seedWc(db);
  const seeded = await seedHistory(db, {
    workCenterId: a.id, workCenterName: a.name,
    startingParams: { BatchSize: '10' },
    trace: [{ step_oid: 's-1', state: 'completed', order: 0, timestamp: 1 }],
    properties: { env: 'prod' },
    stepParams: { 's-1': { in: 'x' } },
    stepNames: { 's-1': 'Start' },
  });

  const detail = await getRuntimeHistoryDetail(db, seeded.id);
  expect(detail).toBeDefined();
  expect(detail!.id).toBe(seeded.id);
  expect(detail!.startingParams).toEqual({ BatchSize: '10' });
  expect(detail!.trace).toEqual([{ step_oid: 's-1', state: 'completed', order: 0, timestamp: 1 }]);
  expect(detail!.properties).toEqual({ env: 'prod' });
  expect(detail!.stepParams).toEqual({ 's-1': { in: 'x' } });
  expect(detail!.stepNames).toEqual({ 's-1': 'Start' });
  expect(detail!.workCenterId).toBe(a.id);
  expect(detail!.masterName).toBe('WF');

  expect(await getRuntimeHistoryDetail(db, NIL)).toBeUndefined();

  await close();
});

test('deleteRuntimeHistory: deletes the row; unknown id throws HISTORY_NOT_FOUND', async () => {
  const { db, close } = await makeTestDb();
  const seeded = await seedHistory(db);

  await deleteRuntimeHistory(db, seeded.id);
  const [after] = await db.select().from(runtimeHistory).where(eq(runtimeHistory.id, seeded.id));
  expect(after).toBeUndefined();

  await expectDaoError(deleteRuntimeHistory(db, seeded.id), 'HISTORY_NOT_FOUND');
  await expectDaoError(deleteRuntimeHistory(db, NIL), 'HISTORY_NOT_FOUND');

  await close();
});

test('countRuntimeHistoryBefore / purgeRuntimeHistory agreement, unscoped', async () => {
  const { db, close } = await makeTestDb();
  await seedHistory(db, { finishedAt: new Date('2026-01-01') });
  await seedHistory(db, { finishedAt: new Date('2026-01-02') });
  const keeper = await seedHistory(db, { finishedAt: new Date('2026-06-01') });

  const cutoff = new Date('2026-03-01');
  const count = await countRuntimeHistoryBefore(db, { olderThan: cutoff });
  expect(count).toBe(2);

  const purged = await purgeRuntimeHistory(db, { olderThan: cutoff });
  expect(purged).toBe(count);

  const remaining = await db.select().from(runtimeHistory);
  expect(remaining).toHaveLength(1);
  expect(remaining[0].id).toBe(keeper.id);

  const countAfter = await countRuntimeHistoryBefore(db, { olderThan: cutoff });
  expect(countAfter).toBe(0);

  await close();
});

test('countRuntimeHistoryBefore / purgeRuntimeHistory agreement, WC-scoped, and scoped purge leaves orphans + other WCs', async () => {
  const { db, close } = await makeTestDb();
  const a = await seedWc(db);
  const b = await seedWc(db);

  const oldA = await seedHistory(db, { workCenterId: a.id, workCenterName: a.name, finishedAt: new Date('2026-01-01') });
  const oldB = await seedHistory(db, { workCenterId: b.id, workCenterName: b.name, finishedAt: new Date('2026-01-01') });
  const oldOrphan = await seedHistory(db, { workCenterId: null, workCenterName: '(deleted)', finishedAt: new Date('2026-01-01') });

  const cutoff = new Date('2026-03-01');
  const count = await countRuntimeHistoryBefore(db, { olderThan: cutoff, workCenterId: a.id });
  expect(count).toBe(1);

  const purged = await purgeRuntimeHistory(db, { olderThan: cutoff, workCenterId: a.id });
  expect(purged).toBe(count);

  const remainingIds = (await db.select({ id: runtimeHistory.id }).from(runtimeHistory)).map((r: any) => r.id).sort();
  expect(remainingIds).toEqual([oldB.id, oldOrphan.id].sort());

  const countAfter = await countRuntimeHistoryBefore(db, { olderThan: cutoff, workCenterId: a.id });
  expect(countAfter).toBe(0);

  await close();
});

const sigRow = (wc: { id: string; name: string }, instanceId: string) => ({
  workflowInstanceId: instanceId, runtimeNumber: 1, runtimeLabel: 'RW-1', workCenterId: wc.id, workCenterName: wc.name, stepInstanceId: null,
  stepOid: 's-1', stepName: 'Approve', signerUserId: null, signerLoginName: 'jane', signerDisplayName: 'Jane',
  roleId: null, roleName: null, operatorUserId: null, operatorLoginName: 'bob', meaning: null, decision: null,
  outcome: 'signed' as const, failureCode: null,
});

test('getRuntimeHistoryDetail carries the instance signatures; deleteRuntimeHistory removes them with the row', async () => {
  const { db, close } = await makeTestDb();
  const a = await seedWc(db);
  const instanceId = '44444444-4444-4444-8444-444444444444';
  const seeded = await seedHistory(db, { workCenterId: a.id, workCenterName: a.name, workflowInstanceId: instanceId });
  await insertStepSignature(db, sigRow(a, instanceId));
  const detail = await getRuntimeHistoryDetail(db, seeded.id);
  expect(detail!.signatures).toHaveLength(1);
  expect(detail!.signatures[0]).toMatchObject({ stepName: 'Approve', signerLoginName: 'jane', outcome: 'signed' });
  const orphan = await seedHistory(db, { workCenterId: a.id, workCenterName: a.name, workflowInstanceId: null });
  expect((await getRuntimeHistoryDetail(db, orphan.id))!.signatures).toEqual([]);
  await deleteRuntimeHistory(db, seeded.id);
  expect(await listStepSignatures(db, instanceId)).toEqual([]);
  await close();
});

// Three victims (not one) on purpose: purgeRuntimeHistory's signature delete is a single
// `IN (SELECT ...)` subquery, not a client-collected id list re-bound with inArray — this
// proves it discriminates a set of victims from a kept row, not just a single one, while
// staying a constant-parameter-count statement (no per-row bind list, so no 65,535-parameter
// ceiling from node-postgres regardless of how many rows are purged).
test('purgeRuntimeHistory removes the purged rows\' signatures and nothing else', async () => {
  const { db, close } = await makeTestDb();
  const a = await seedWc(db);
  const oldId1 = '55555555-5555-4555-8555-555555555555';
  const oldId2 = '55555555-5555-4555-8555-555555555556';
  const oldId3 = '55555555-5555-4555-8555-555555555557';
  const newId = '66666666-6666-4666-8666-666666666666';
  await seedHistory(db, { workCenterId: a.id, workCenterName: a.name, workflowInstanceId: oldId1, finishedAt: new Date('2026-01-01') });
  await seedHistory(db, { workCenterId: a.id, workCenterName: a.name, workflowInstanceId: oldId2, finishedAt: new Date('2026-01-02') });
  await seedHistory(db, { workCenterId: a.id, workCenterName: a.name, workflowInstanceId: oldId3, finishedAt: new Date('2026-01-03') });
  await seedHistory(db, { workCenterId: a.id, workCenterName: a.name, workflowInstanceId: newId, finishedAt: new Date('2026-09-01') });
  await insertStepSignature(db, sigRow(a, oldId1));
  await insertStepSignature(db, sigRow(a, oldId2));
  await insertStepSignature(db, sigRow(a, oldId3));
  await insertStepSignature(db, sigRow(a, newId));
  expect(await purgeRuntimeHistory(db, { olderThan: new Date('2026-06-01') })).toBe(3);
  expect(await listStepSignatures(db, oldId1)).toEqual([]);
  expect(await listStepSignatures(db, oldId2)).toEqual([]);
  expect(await listStepSignatures(db, oldId3)).toEqual([]);
  expect(await listStepSignatures(db, newId)).toHaveLength(1);
  await close();
});

test('historyRowGate: resolves work_center_id, null for orphans, undefined for unknown', async () => {
  const { db, close } = await makeTestDb();
  const a = await seedWc(db);
  const scoped = await seedHistory(db, { workCenterId: a.id, workCenterName: a.name });
  const orphan = await seedHistory(db, { workCenterId: null, workCenterName: '(deleted)' });

  expect(await historyRowGate(db, scoped.id)).toEqual({ workCenterId: a.id });
  expect(await historyRowGate(db, orphan.id)).toEqual({ workCenterId: null });
  expect(await historyRowGate(db, NIL)).toBeUndefined();

  await close();
});

const runRow = (instanceId: string, over: Record<string, unknown> = {}) => ({
  workflowInstanceId: instanceId, runtimeLabel: 'RW-1', stepOid: 's-1', stepName: 'Mix', stepType: 'USER',
  runNumber: 1, startedAt: new Date('2026-10-27T10:00:00Z'), finishedAt: new Date('2026-10-27T10:05:00Z'),
  result: 'completed' as const, performedByKind: 'user' as const, ...over,
});

test('detail returns step runs oldest first and the starter', async () => {
  const { db, close } = await makeTestDb();
  try {
    const instanceId = '77777777-7777-4777-8777-777777777777';
    await writeRuntimeHistory(db, {
      workflowInstanceId: instanceId, workCenterId: null, workCenterName: 'WC', runtimeNumber: 1, runtimeLabel: 'RW-1',
      masterName: 'WF', masterOid: 'wf-1', masterVersion: '1.0.0', masterState: 'Effective', finalState: 'completed',
      startedAt: null, finishedAt: new Date(), startingParams: null, trace: [], properties: null, stepParams: null,
      stepNames: null, createdByInstanceId: null, createdByLabel: null, outputs: null,
      startedByUserId: null, startedByLoginName: 'jdoe',
    });
    await insertStepRun(db, runRow(instanceId, { stepOid: 'b', runNumber: 2, startedAt: new Date('2026-10-27T10:10:00Z') }));
    await insertStepRun(db, runRow(instanceId, { stepOid: 'a', runNumber: 1 }));
    const [h] = await db.select().from(runtimeHistory).where(eq(runtimeHistory.workflowInstanceId, instanceId));
    const detail = await getRuntimeHistoryDetail(db, h!.id);
    expect(detail!.stepRuns.map((r) => r.runNumber)).toEqual([1, 2]);
    expect(detail!.startedByLoginName).toBe('jdoe');
    expect(detail!.startedByUserId).toBeNull();
  } finally { await close(); }
});

test('detail resolves [by uuid] actors to login names', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [bob] = await db.insert(appUser).values({ email: 'bob@example.com', displayName: 'Bob', loginName: 'bob' }).returning();
    const unknown = '99999999-9999-4999-8999-999999999999';
    const seeded = await seedHistory(db, {
      trace: [
        { state: 'OPERATOR', error: `Forced complete [by ${bob!.id}]` },
        { state: 'OPERATOR', error: `Skipped [by ${unknown}]` },
        { state: 'X', error: null },
      ] as any,
    });
    const detail = await getRuntimeHistoryDetail(db, seeded.id);
    expect(detail!.userNames).toEqual({ [bob!.id]: 'bob' });
    const none = await seedHistory(db);
    expect((await getRuntimeHistoryDetail(db, none.id))!.userNames).toEqual({});
  } finally { await close(); }
});

test('delete removes the step runs', async () => {
  const { db, close } = await makeTestDb();
  try {
    const instanceId = '88888888-8888-4888-8888-888888888888';
    const seeded = await seedHistory(db, { workflowInstanceId: instanceId });
    await insertStepRun(db, runRow(instanceId));
    await deleteRuntimeHistory(db, seeded.id);
    expect(await listStepRuns(db, instanceId)).toEqual([]);
  } finally { await close(); }
});

test('purge removes the step runs of purged rows only', async () => {
  const { db, close } = await makeTestDb();
  try {
    const old1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
    const old2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
    const keep = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    await seedHistory(db, { workflowInstanceId: old1, finishedAt: new Date('2026-01-01') });
    await seedHistory(db, { workflowInstanceId: old2, finishedAt: new Date('2026-01-02') });
    await seedHistory(db, { workflowInstanceId: keep, finishedAt: new Date('2026-09-01') });
    for (const id of [old1, old2, keep]) await insertStepRun(db, runRow(id));
    expect(await purgeRuntimeHistory(db, { olderThan: new Date('2026-06-01') })).toBe(2);
    expect(await listStepRuns(db, old1)).toEqual([]);
    expect(await listStepRuns(db, old2)).toEqual([]);
    expect(await listStepRuns(db, keep)).toHaveLength(1);
  } finally { await close(); }
});

test('detail ignores a malformed [by ...] marker typed into a reason', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [bob] = await db.insert(appUser).values({ email: 'bob2@example.com', displayName: 'Bob', loginName: 'bob2' }).returning();
    const seeded = await seedHistory(db, {
      trace: [{ state: 'OPERATOR', error: `Forced complete: [by ${'-'.repeat(36)}] [by ${bob!.id}]` }] as any,
    });
    const detail = await getRuntimeHistoryDetail(db, seeded.id);
    expect(detail!.userNames).toEqual({ [bob!.id]: 'bob2' });
  } finally { await close(); }
});
