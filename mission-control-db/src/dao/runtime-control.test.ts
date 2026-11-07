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
import { workCenter, workflow, workflowInstance } from '../db/schema/index.js';
import { createUser } from './users.js';
import { DaoError } from './errors.js';
import {
  requestPause, requestResume, requestStop, requestAbort, requestSkipCleanup,
} from './runtime-control.js';
import { listControlEvents, latestControlEvent } from './control-events.js';
import { runtimeCols } from '../../test/helpers/instances.js';

const SYS = { kind: 'system', label: 'test' } as const;
const NIL = '00000000-0000-0000-0000-000000000000';

async function expectDaoError(p: Promise<unknown>, code: string): Promise<void> {
  try {
    await p;
    expect.fail(`expected DaoError ${code}`);
  } catch (err) {
    expect(err).toBeInstanceOf(DaoError);
    expect((err as DaoError).code).toBe(code);
  }
}

async function seed(db: any) {
  const [wc] = await db.insert(workCenter).values({ name: `WC-${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({
    oid: 'wf-1', name: 'WF', workCenterId: wc.id, version: '1.2.0', state: 'Effective', specJsonb: {},
  }).returning();
  return { wc, wf };
}

test('requestPause: running→pausing success; from other statuses → RUNTIME_INVALID_STATE', async () => {
  const { db, close } = await makeTestDb();
  const { wc, wf } = await seed(db);

  // Success: running → pausing
  const running = await db.insert(workflowInstance).values({
    workflowId: wf.id,
    workCenterId: wc.id,
    triggeredBy: 'manual',
    status: 'running',
    ...runtimeCols(),
  }).returning();
  await requestPause(db, running[0].id);
  const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, running[0].id));
  expect(after.status).toBe('pausing');

  // Failure: other statuses
  for (const status of ['pending', 'queued', 'pausing', 'paused', 'resuming', 'stopping', 'aborting', 'completed', 'aborted', 'errored', 'stopped']) {
    const instance = await db.insert(workflowInstance).values({
      workflowId: wf.id,
      workCenterId: wc.id,
      triggeredBy: 'manual',
      status,
      ...runtimeCols(),
    }).returning();
    await expectDaoError(
      requestPause(db, instance[0].id),
      'RUNTIME_INVALID_STATE',
    );
  }

  // Not found
  await expectDaoError(requestPause(db, NIL), 'RUNTIME_NOT_FOUND');

  await close();
});

test('requestResume: paused→resuming success; from other statuses → RUNTIME_INVALID_STATE', async () => {
  const { db, close } = await makeTestDb();
  const { wc, wf } = await seed(db);

  // Success: paused → resuming
  const paused = await db.insert(workflowInstance).values({
    workflowId: wf.id,
    workCenterId: wc.id,
    triggeredBy: 'manual',
    status: 'paused',
    ...runtimeCols(),
  }).returning();
  await requestResume(db, paused[0].id);
  const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, paused[0].id));
  expect(after.status).toBe('resuming');

  // Failure: other statuses
  for (const status of ['pending', 'queued', 'running', 'pausing', 'resuming', 'stopping', 'aborting', 'completed', 'aborted', 'errored', 'stopped']) {
    const instance = await db.insert(workflowInstance).values({
      workflowId: wf.id,
      workCenterId: wc.id,
      triggeredBy: 'manual',
      status,
      ...runtimeCols(),
    }).returning();
    await expectDaoError(
      requestResume(db, instance[0].id),
      'RUNTIME_INVALID_STATE',
    );
  }

  // Not found
  await expectDaoError(requestResume(db, NIL), 'RUNTIME_NOT_FOUND');

  await close();
});

test('requestStop: running|paused|pausing→stopping success; from other statuses → RUNTIME_INVALID_STATE', async () => {
  const { db, close } = await makeTestDb();
  const { wc, wf } = await seed(db);

  // Success cases
  for (const status of ['running', 'paused', 'pausing']) {
    const instance = await db.insert(workflowInstance).values({
      workflowId: wf.id,
      workCenterId: wc.id,
      triggeredBy: 'manual',
      status,
      ...runtimeCols(),
    }).returning();
    await requestStop(db, instance[0].id, SYS);
    const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, instance[0].id));
    expect(after.status).toBe('stopping');
  }

  // Failure: other statuses
  for (const status of ['pending', 'queued', 'resuming', 'stopping', 'aborting', 'completed', 'aborted', 'errored', 'stopped']) {
    const instance = await db.insert(workflowInstance).values({
      workflowId: wf.id,
      workCenterId: wc.id,
      triggeredBy: 'manual',
      status,
      ...runtimeCols(),
    }).returning();
    await expectDaoError(
      requestStop(db, instance[0].id, SYS),
      'RUNTIME_INVALID_STATE',
    );
  }

  // Not found
  await expectDaoError(requestStop(db, NIL, SYS), 'RUNTIME_NOT_FOUND');

  await close();
});

test('requestAbort: from every abortable status (stopping_cleanup escalates) → aborting success; aborting/aborting_cleanup refused; from others → RUNTIME_INVALID_STATE', async () => {
  const { db, close } = await makeTestDb();
  const { wc, wf } = await seed(db);

  // Success cases: queued, running, pausing, paused, resuming, stopping
  for (const status of ['queued', 'running', 'pausing', 'paused', 'resuming', 'stopping', 'stopping_cleanup']) {
    const instance = await db.insert(workflowInstance).values({
      workflowId: wf.id,
      workCenterId: wc.id,
      triggeredBy: 'manual',
      status,
      ...runtimeCols(),
    }).returning();
    await requestAbort(db, instance[0].id, SYS);
    const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, instance[0].id));
    expect(after.status).toBe('aborting');
  }

  // Failure: aborting and aborting_cleanup (a second Abort is never a skip)
  for (const status of ['aborting', 'aborting_cleanup']) {
    const refused = await db.insert(workflowInstance).values({
      workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status, ...runtimeCols(),
    }).returning();
    await expectDaoError(requestAbort(db, refused[0].id, SYS), 'RUNTIME_INVALID_STATE');
  }

  // Failure: other statuses
  for (const status of ['pending', 'completed', 'aborted', 'errored', 'stopped']) {
    const instance = await db.insert(workflowInstance).values({
      workflowId: wf.id,
      workCenterId: wc.id,
      triggeredBy: 'manual',
      status,
      ...runtimeCols(),
    }).returning();
    await expectDaoError(
      requestAbort(db, instance[0].id, SYS),
      'RUNTIME_INVALID_STATE',
    );
  }

  // Not found
  await expectDaoError(requestAbort(db, NIL, SYS), 'RUNTIME_NOT_FOUND');

  await close();
});

async function inst(db: any, status: string) {
  const { wc, wf } = await seed(db);
  const [i] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status, ...runtimeCols(),
  }).returning();
  return i.id as string;
}
const rowOf = async (db: any, id: string) =>
  (await db.select().from(workflowInstance).where(eq(workflowInstance.id, id)))[0];

test('requestStop records the requesting user', async () => {
  const { db, close } = await makeTestDb();
  try {
    const u = await createUser(db, { email: 'jd@x.io', displayName: 'Jane Doe', loginName: 'jdoe' });
    const id = await inst(db, 'running');
    await requestStop(db, id, { kind: 'user', userId: u.id });
    expect((await rowOf(db, id)).status).toBe('stopping');
    const ev = await listControlEvents(db, id);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ verb: 'stop', effect: 'request', fromStatus: 'running', toStatus: 'stopping',
      actorKind: 'user', actorUserId: u.id, actorName: 'Jane Doe' });
    expect(await latestControlEvent(db, id, 'stop')).toMatchObject({ actorName: 'Jane Doe' });
    expect(await latestControlEvent(db, id, 'abort')).toBeNull();
  } finally { await close(); }
});

test('unknown user actor throws USER_NOT_FOUND and changes nothing', async () => {
  const { db, close } = await makeTestDb();
  try {
    const id = await inst(db, 'running');
    await expectDaoError(requestStop(db, id, { kind: 'user', userId: NIL }), 'USER_NOT_FOUND');
    expect((await rowOf(db, id)).status).toBe('running');
    expect(await listControlEvents(db, id)).toHaveLength(0);
  } finally { await close(); }
});

test('requestStop from stopping_cleanup, stopping, aborting and aborting_cleanup is refused with no event', async () => {
  const { db, close } = await makeTestDb();
  try {
    for (const st of ['stopping_cleanup', 'stopping', 'aborting', 'aborting_cleanup']) {
      const id = await inst(db, st);
      await expectDaoError(requestStop(db, id, SYS), 'RUNTIME_INVALID_STATE');
      expect(await listControlEvents(db, id)).toHaveLength(0);
    }
  } finally { await close(); }
});

test('requestAbort from stopping_cleanup escalates', async () => {
  const { db, close } = await makeTestDb();
  try {
    const id = await inst(db, 'stopping_cleanup');
    await requestAbort(db, id, SYS);
    expect((await rowOf(db, id)).status).toBe('aborting');
    expect(await listControlEvents(db, id)).toMatchObject([{ verb: 'abort', effect: 'escalate', fromStatus: 'stopping_cleanup', toStatus: 'aborting' }]);
  } finally { await close(); }
});

test('requestAbort from running is a plain request event', async () => {
  const { db, close } = await makeTestDb();
  try {
    const id = await inst(db, 'running');
    await requestAbort(db, id, SYS);
    expect(await listControlEvents(db, id)).toMatchObject([{ verb: 'abort', effect: 'request' }]);
  } finally { await close(); }
});

test("requestSkipCleanup('stop') from stopping_cleanup", async () => {
  const { db, close } = await makeTestDb();
  try {
    const id = await inst(db, 'stopping_cleanup');
    await requestSkipCleanup(db, id, 'stop', SYS);
    const row = await rowOf(db, id);
    expect(row.status).toBe('stopping');
    expect(row.cleanupSkip).toBe('stop');
    expect(await listControlEvents(db, id)).toMatchObject([{ verb: 'stop', effect: 'skip_cleanup', fromStatus: 'stopping_cleanup', toStatus: 'stopping' }]);
  } finally { await close(); }
});

test("requestSkipCleanup('stop') from aborting_cleanup is refused", async () => {
  const { db, close } = await makeTestDb();
  try {
    const id = await inst(db, 'aborting_cleanup');
    await expectDaoError(requestSkipCleanup(db, id, 'stop', SYS), 'RUNTIME_INVALID_STATE');
    expect(await listControlEvents(db, id)).toHaveLength(0);
  } finally { await close(); }
});

test("requestSkipCleanup('abort') from aborting keeps aborting and sets cleanup_skip", async () => {
  const { db, close } = await makeTestDb();
  try {
    const id = await inst(db, 'aborting');
    await requestSkipCleanup(db, id, 'abort', SYS);
    const row = await rowOf(db, id);
    expect(row.status).toBe('aborting');
    expect(row.cleanupSkip).toBe('abort');
    expect(await listControlEvents(db, id)).toMatchObject([{ verb: 'abort', effect: 'skip_cleanup', fromStatus: 'aborting', toStatus: 'aborting' }]);
  } finally { await close(); }
});

test('refusal message names skip cleanup', async () => {
  const { db, close } = await makeTestDb();
  try {
    const id = await inst(db, 'running');
    await expect(requestSkipCleanup(db, id, 'stop', SYS)).rejects.toThrow('cannot skip cleanup from running');
  } finally { await close(); }
});

test('remote actor is stored by label', async () => {
  const { db, close } = await makeTestDb();
  try {
    const id = await inst(db, 'running');
    await requestStop(db, id, { kind: 'remote', label: 'WC1/R-0007', instanceId: NIL });
    const ev = await listControlEvents(db, id);
    expect(ev[0]).toMatchObject({ actorKind: 'remote', actorName: 'WC1/R-0007', actorUserId: null, actorInstanceId: NIL });
  } finally { await close(); }
});

test('remote source runtime id is stored (U8); user and system actors have none', async () => {
  const { db, close } = await makeTestDb();
  try {
    const SRC = '33333333-3333-4333-8333-333333333333'; // a soft link: no FK, may name a deleted runtime
    const id = await inst(db, 'running');
    await requestAbort(db, id, { kind: 'remote', label: 'WC1/R-0008', instanceId: SRC });
    const id2 = await inst(db, 'running');
    await requestStop(db, id2, { kind: 'remote', label: 'Broker', instanceId: null });
    const id3 = await inst(db, 'running');
    await requestStop(db, id3, SYS);
    expect((await listControlEvents(db, id))[0]).toMatchObject({ actorKind: 'remote', actorInstanceId: SRC });
    expect((await latestControlEvent(db, id, 'abort'))?.actorInstanceId).toBe(SRC);
    expect((await listControlEvents(db, id2))[0].actorInstanceId).toBeNull();
    expect((await listControlEvents(db, id3))[0].actorInstanceId).toBeNull();
  } finally { await close(); }
});

test('requestAbort with recordAsVerb records the verb that was sent, in the same transaction', async () => {
  const { db, close } = await makeTestDb();
  try {
    const id = await inst(db, 'queued');
    await requestAbort(db, id, { kind: 'remote', label: 'WC1/R-0009', instanceId: NIL }, { recordAsVerb: 'stop' });
    const [row] = await db.select({ status: workflowInstance.status }).from(workflowInstance).where(eq(workflowInstance.id, id));
    expect(row.status).toBe('aborting');
    const ev = await listControlEvents(db, id);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ verb: 'stop', effect: 'request', fromStatus: 'queued', toStatus: 'aborting' });
  } finally { await close(); }
});

test("requestSkipCleanup('stop') from plain stopping sets cleanup_skip and records the event", async () => {
  const { db, close } = await makeTestDb();
  try {
    const id = await inst(db, 'stopping');
    await requestSkipCleanup(db, id, 'stop', SYS);
    const row = await rowOf(db, id);
    expect(row.status).toBe('stopping');
    expect(row.cleanupSkip).toBe('stop');
    expect(await listControlEvents(db, id)).toMatchObject([{ verb: 'stop', effect: 'skip_cleanup', fromStatus: 'stopping', toStatus: 'stopping' }]);
  } finally { await close(); }
});

test("requestSkipCleanup('abort') from aborting_cleanup goes to aborting", async () => {
  const { db, close } = await makeTestDb();
  try {
    const id = await inst(db, 'aborting_cleanup');
    await requestSkipCleanup(db, id, 'abort', SYS);
    const row = await rowOf(db, id);
    expect(row.status).toBe('aborting');
    expect(row.cleanupSkip).toBe('abort');
    expect(await listControlEvents(db, id)).toMatchObject([{ verb: 'abort', effect: 'skip_cleanup', fromStatus: 'aborting_cleanup', toStatus: 'aborting' }]);
  } finally { await close(); }
});
