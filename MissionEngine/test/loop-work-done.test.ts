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
// Spec 2026-09-14 §4.7: runOnce reports "something happened" through deps.onWorkDone so the
// property watch can re-read WAITING_GATE rows promptly. Fired once per cycle that did work,
// never on an idle cycle, and a throwing hook never escapes runOnce (which never throws).
import { expect, test, vi } from 'vitest';
import { workCenter, workflow, workflowInstance } from 'mission-control-db/src/db/schema/index';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { runOnce } from '../src/loop.js';

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});

const SPEC = {
  local_id: 'wf', oid: 'wf-work-done', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [step('s', 'START'), step('e', 'END')],
  connections: [{ from_step_id: 's', to_step_id: 'e' }],
};

async function seedQueued(db: any, spec: any): Promise<void> {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({ workCenterId: wc.id, oid: spec.oid, name: spec.oid, version: '1.0.0', state: 'Approved', specJsonb: spec }).returning();
  await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
    specJsonb: spec, startingParams: null, runtimeNumber: 1, runtimeLabel: 'RW-1',
    masterName: spec.oid, masterOid: spec.oid, masterVersion: '1.0.0', masterState: 'Approved',
  });
}

test('runOnce fires deps.onWorkDone once per cycle that did work and never on an idle cycle', async () => {
  const { db, close } = await makeTestDb();
  const onWorkDone = vi.fn();
  const deps = testDeps({ onWorkDone });
  await seedQueued(db, SPEC);

  const cycles = await pumpUntilQuiet(db, deps);
  expect(cycles).toBeGreaterThan(0);
  expect(onWorkDone).toHaveBeenCalledTimes(cycles);

  onWorkDone.mockClear();
  expect(await runOnce(db, deps)).toBe(false);
  expect(onWorkDone).not.toHaveBeenCalled();
  await close();
});

test('a throwing onWorkDone is logged and never escapes runOnce', async () => {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { db, close } = await makeTestDb();
  const deps = testDeps({ onWorkDone: () => { throw new Error('hook boom'); } });
  await seedQueued(db, SPEC);

  await expect(pumpUntilQuiet(db, deps)).resolves.toBeGreaterThan(0);
  expect(errorSpy.mock.calls.some((c) => String(c[0]).includes('hook boom'))).toBe(true);
  errorSpy.mockRestore();
  await close();
});

test('deps without onWorkDone behave exactly as before', async () => {
  const { db, close } = await makeTestDb();
  await seedQueued(db, SPEC);
  await expect(pumpUntilQuiet(db, testDeps())).resolves.toBeGreaterThan(0);
  await close();
});
