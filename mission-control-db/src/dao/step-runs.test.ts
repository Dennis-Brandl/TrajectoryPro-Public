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
import { makeTestDb } from '../../test/helpers/db.js';
import { insertStepRun, countStepRuns, countStepRunsStartedBefore, listStepRuns, deleteStepRunsForInstances } from './step-runs.js';

const INSTANCE_A = '11111111-1111-4111-8111-111111111111';
const INSTANCE_B = '22222222-2222-4222-8222-222222222222';

function row(instanceId: string, over: Record<string, unknown> = {}) {
  return {
    workflowInstanceId: instanceId, runtimeLabel: 'RW-7', stepOid: 's-1', stepName: 'Mix', stepType: 'USER',
    runNumber: 1, startedAt: new Date('2026-10-27T10:00:00Z'), finishedAt: new Date('2026-10-27T10:05:00Z'),
    result: 'completed' as const, performedByKind: 'user' as const, ...over,
  };
}

test('insert + list returns oldest-first view rows; soft-linked instance needs no instance row', async () => {
  const { db, close } = await makeTestDb();
  try {
    await insertStepRun(db, row(INSTANCE_A, { stepOid: 'c', startedAt: new Date('2026-10-27T10:02:00Z') }));
    await insertStepRun(db, row(INSTANCE_A, { stepOid: 'a', startedAt: new Date('2026-10-27T10:00:00Z') }));
    await insertStepRun(db, row(INSTANCE_A, { stepOid: 'b', startedAt: null, finishedAt: new Date('2026-10-27T10:01:00Z') }));
    await insertStepRun(db, row(INSTANCE_B));
    const list = await listStepRuns(db, INSTANCE_A);
    expect(list.map((r) => r.stepOid)).toEqual(['a', 'b', 'c']);
    expect(list[0]).toEqual({
      id: expect.any(String), stepInstanceId: null, stepOid: 'a', stepName: 'Mix', stepType: 'USER', runNumber: 1,
      startedAt: new Date('2026-10-27T10:00:00Z'), finishedAt: new Date('2026-10-27T10:05:00Z'),
      result: 'completed', error: null, inputParameters: null, outputParameters: null,
      performedByLoginName: null, performedByKind: 'user', nodePath: [],
    });
  } finally { await close(); }
});

test('countStepRuns counts per step oid', async () => {
  const { db, close } = await makeTestDb();
  try {
    await insertStepRun(db, row(INSTANCE_A, { stepOid: 's-1' }));
    await insertStepRun(db, row(INSTANCE_A, { stepOid: 's-1', runNumber: 2 }));
    await insertStepRun(db, row(INSTANCE_A, { stepOid: 's-2' }));
    expect(await countStepRuns(db, INSTANCE_A, 's-1')).toBe(2);
    expect(await countStepRuns(db, INSTANCE_A, 's-2')).toBe(1);
    expect(await countStepRuns(db, INSTANCE_A, 's-3')).toBe(0);
  } finally { await close(); }
});

test('countStepRunsStartedBefore counts only that step oid runs started strictly before the instant', async () => {
  const { db, close } = await makeTestDb();
  try {
    await insertStepRun(db, row(INSTANCE_A, { startedAt: new Date('2026-10-27T10:00:00Z') }));
    await insertStepRun(db, row(INSTANCE_A, { runNumber: 2, startedAt: new Date('2026-10-27T10:10:00Z') }));
    await insertStepRun(db, row(INSTANCE_A, { runNumber: 3, startedAt: new Date('2026-10-27T10:20:00Z') }));
    await insertStepRun(db, row(INSTANCE_A, { stepOid: 's-2', startedAt: new Date('2026-10-27T09:00:00Z') }));
    await insertStepRun(db, row(INSTANCE_B, { startedAt: new Date('2026-10-27T09:00:00Z') }));
    expect(await countStepRunsStartedBefore(db, INSTANCE_A, 's-1', new Date('2026-10-27T10:10:00Z'))).toBe(1);
    expect(await countStepRunsStartedBefore(db, INSTANCE_A, 's-1', new Date('2026-10-27T10:10:00.001Z'))).toBe(2);
    expect(await countStepRunsStartedBefore(db, INSTANCE_A, 's-1', new Date('2026-10-27T09:00:00Z'))).toBe(0);
  } finally { await close(); }
});

test('deleteStepRunsForInstances deletes only listed instances', async () => {
  const { db, close } = await makeTestDb();
  try {
    await insertStepRun(db, row(INSTANCE_A));
    await insertStepRun(db, row(INSTANCE_B));
    expect(await deleteStepRunsForInstances(db, [])).toBe(0);
    expect(await deleteStepRunsForInstances(db, [INSTANCE_A])).toBe(1);
    expect(await listStepRuns(db, INSTANCE_A)).toEqual([]);
    expect(await listStepRuns(db, INSTANCE_B)).toHaveLength(1);
  } finally { await close(); }
});

test('result and kind CHECKs reject unknown values', async () => {
  const { db, close } = await makeTestDb();
  try {
    await expect(insertStepRun(db, row(INSTANCE_A, { result: 'skipped' }) as any)).rejects.toThrow();
    await expect(insertStepRun(db, row(INSTANCE_A, { performedByKind: 'robot' }) as any)).rejects.toThrow();
  } finally { await close(); }
});
