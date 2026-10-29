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
  requestPause, requestResume, requestStop, requestAbort,
} from './runtime-control.js';
import { runtimeCols } from '../../test/helpers/instances.js';

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
    await requestStop(db, instance[0].id);
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
      requestStop(db, instance[0].id),
      'RUNTIME_INVALID_STATE',
    );
  }

  // Not found
  await expectDaoError(requestStop(db, NIL), 'RUNTIME_NOT_FOUND');

  await close();
});

test('requestAbort: from all RUNTIME_ACTIVE_STATUSES except aborting→aborting success; from others → RUNTIME_INVALID_STATE', async () => {
  const { db, close } = await makeTestDb();
  const { wc, wf } = await seed(db);

  // Success cases: queued, running, pausing, paused, resuming, stopping
  for (const status of ['queued', 'running', 'pausing', 'paused', 'resuming', 'stopping']) {
    const instance = await db.insert(workflowInstance).values({
      workflowId: wf.id,
      workCenterId: wc.id,
      triggeredBy: 'manual',
      status,
      ...runtimeCols(),
    }).returning();
    await requestAbort(db, instance[0].id);
    const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, instance[0].id));
    expect(after.status).toBe('aborting');
  }

  // Failure: aborting (idempotent re-request rejected)
  const aborting = await db.insert(workflowInstance).values({
    workflowId: wf.id,
    workCenterId: wc.id,
    triggeredBy: 'manual',
    status: 'aborting',
    ...runtimeCols(),
  }).returning();
  await expectDaoError(
    requestAbort(db, aborting[0].id),
    'RUNTIME_INVALID_STATE',
  );

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
      requestAbort(db, instance[0].id),
      'RUNTIME_INVALID_STATE',
    );
  }

  // Not found
  await expectDaoError(requestAbort(db, NIL), 'RUNTIME_NOT_FOUND');

  await close();
});
