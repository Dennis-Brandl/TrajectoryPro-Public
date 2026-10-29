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
import { runtimeCols } from '../../test/helpers/instances.js';
import { workCenter, environmentSpec, workflow, workflowInstance, schedule, workflowEnvironment } from '../db/schema/index.js';
import { deleteEnvironmentSpec, listEnvironmentSpecSummaries } from './environments.js';

test('listEnvironmentSpecSummaries orders by work center, name, version, state', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [b] = await db.insert(workCenter).values({ name: 'Line 2' }).returning();
    const [a] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    await db.insert(environmentSpec).values([
      { oid: 'e', name: 'DemoLine', workCenterId: b.id, version: '1.0.0', state: 'Draft', specJsonb: {} },
      { oid: 'e', name: 'DemoLine', workCenterId: a.id, version: '2.0.0', state: 'Draft', specJsonb: {} },
      { oid: 'e', name: 'DemoLine', workCenterId: a.id, version: '1.0.0', state: 'Effective', specJsonb: {} },
      { oid: 'e', name: 'DemoLine', workCenterId: a.id, version: '1.0.0', state: 'Draft', specJsonb: {} },
    ]);
    const rows = await listEnvironmentSpecSummaries(db);
    expect(rows.map((r) => `${r.workCenterName} ${r.version} ${r.state}`)).toEqual([
      'Line 1 1.0.0 Draft', 'Line 1 1.0.0 Effective', 'Line 1 2.0.0 Draft', 'Line 2 1.0.0 Draft',
    ]);
    expect(rows[0]).not.toHaveProperty('specJsonb'); // light projection — do not ship the spec blob to every tree render
  } finally { await close(); }
});

// Coverage debt from Tasks 4 and 5: sourceLibraryName/sourceLibraryOid are Designer provenance
// (spec D9) — display-only, never used to route or group — but they must still reach the
// caller through the summary projection, not just be typed on EnvironmentSummary. Also covers
// workCenterId, the other field the brief's interface names that nothing previously asserted
// round-trips.
test('listEnvironmentSpecSummaries carries Designer provenance and workCenterId through the projection', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    await db.insert(environmentSpec).values({
      oid: 'e', name: 'DemoLine', workCenterId: wc.id, specJsonb: {},
      sourceLibraryName: 'Studio Recipes', sourceLibraryOid: 'studio-lib-42',
    });
    const [row] = await listEnvironmentSpecSummaries(db);
    expect(row.sourceLibraryName).toBe('Studio Recipes');
    expect(row.sourceLibraryOid).toBe('studio-lib-42');
    expect(row.workCenterId).toBe(wc.id);
  } finally { await close(); }
});

test('deleteEnvironmentSpec removes an entry with no embedding workflows', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const [env] = await db.insert(environmentSpec).values({
      oid: 'e', name: 'Env', workCenterId: wc.id, specJsonb: {},
    }).returning();
    await deleteEnvironmentSpec(db, env.id);
    expect(await db.select().from(environmentSpec)).toHaveLength(0);
  } finally { await close(); }
});

// work_center_environment is gone, and workflow_environment (CASCADE — the join row is owned
// by the workflow side, never the spec, per spec §5) no longer blocks. But workflow_instance
// and schedule still reference an environment spec (both ON DELETE SET NULL) and DO block per
// spec §7.4 ("An entry referenced by an instance or a schedule is refused with a 409 naming
// the blocker") — see the two tests below. An unconditional delete would silently null out a
// completed run's or an enabled schedule's environment reference.
test('deleteEnvironmentSpec removes an entry even while a workflow embeds it', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const [env] = await db.insert(environmentSpec).values({
      oid: 'e', name: 'Env', workCenterId: wc.id, specJsonb: {},
    }).returning();
    const [wf] = await db.insert(workflow).values({
      oid: 'w', name: 'WF', workCenterId: wc.id, specJsonb: {},
    }).returning();
    await db.insert(workflowEnvironment).values({ workflowId: wf.id, environmentSpecId: env.id });
    await deleteEnvironmentSpec(db, env.id);
    expect(await db.select().from(environmentSpec)).toHaveLength(0);
    expect(await db.select().from(workflowEnvironment)).toHaveLength(0);
    expect(await db.select().from(workflow)).toHaveLength(1); // the workflow itself is untouched
  } finally { await close(); }
});

test('deleteEnvironmentSpec is blocked when an unfinished (pending) runtime references it', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const [env] = await db.insert(environmentSpec).values({
      oid: 'e', name: 'Env', workCenterId: wc.id, specJsonb: {},
    }).returning();
    const [wf] = await db.insert(workflow).values({
      oid: 'w', name: 'WF', workCenterId: wc.id, specJsonb: {},
    }).returning();
    await db.insert(workflowInstance).values({
      workflowId: wf.id, workCenterId: wc.id, environmentSpecId: env.id, triggeredBy: 'manual',
      ...runtimeCols(),
    });
    await expect(deleteEnvironmentSpec(db, env.id)).rejects.toMatchObject({
      code: 'ENVIRONMENT_IN_USE', message: 'Environment spec has runtime workflows that have not finished',
    });
    expect(await db.select().from(environmentSpec)).toHaveLength(1); // not deleted
  } finally { await close(); }
});

test('finished runtimes do not block deleteEnvironmentSpec: the runtime stays and only loses its link', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const [env] = await db.insert(environmentSpec).values({
      oid: 'e', name: 'Env', workCenterId: wc.id, specJsonb: {},
    }).returning();
    const [wf] = await db.insert(workflow).values({
      oid: 'w', name: 'WF', workCenterId: wc.id, specJsonb: {},
    }).returning();
    const runs = await db.insert(workflowInstance).values(
      (['completed', 'aborted', 'stopped', 'errored'] as const).map((status) => ({
        workflowId: wf.id, workCenterId: wc.id, environmentSpecId: env.id, triggeredBy: 'manual' as const, status, ...runtimeCols(),
      })),
    ).returning();
    await deleteEnvironmentSpec(db, env.id);
    expect(await db.select().from(environmentSpec)).toHaveLength(0);
    const after = await db.select().from(workflowInstance).where(eq(workflowInstance.workflowId, wf.id));
    expect(after.map((r) => r.id).sort()).toEqual(runs.map((r) => r.id).sort());
    expect(after.every((r) => r.environmentSpecId === null)).toBe(true);
  } finally { await close(); }
});

test('deleteEnvironmentSpec is blocked by a running runtime even beside a finished one', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const [env] = await db.insert(environmentSpec).values({
      oid: 'e', name: 'Env', workCenterId: wc.id, specJsonb: {},
    }).returning();
    const [wf] = await db.insert(workflow).values({
      oid: 'w', name: 'WF', workCenterId: wc.id, specJsonb: {},
    }).returning();
    await db.insert(workflowInstance).values([
      { workflowId: wf.id, workCenterId: wc.id, environmentSpecId: env.id, triggeredBy: 'manual', status: 'completed', ...runtimeCols() },
      { workflowId: wf.id, workCenterId: wc.id, environmentSpecId: env.id, triggeredBy: 'manual', status: 'running', ...runtimeCols() },
    ]);
    await expect(deleteEnvironmentSpec(db, env.id)).rejects.toMatchObject({ code: 'ENVIRONMENT_IN_USE' });
    expect(await db.select().from(environmentSpec)).toHaveLength(1);
  } finally { await close(); }
});

test('deleteEnvironmentSpec is blocked when a schedule references it, even with no instances', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const [env] = await db.insert(environmentSpec).values({
      oid: 'e', name: 'Env', workCenterId: wc.id, specJsonb: {},
    }).returning();
    const [wf] = await db.insert(workflow).values({
      oid: 'w', name: 'WF', workCenterId: wc.id, specJsonb: {},
    }).returning();
    await db.insert(schedule).values({
      workCenterId: wc.id, workflowId: wf.id, environmentSpecId: env.id, name: 'Nightly', kind: 'recurring',
    });
    await expect(deleteEnvironmentSpec(db, env.id)).rejects.toMatchObject({
      code: 'ENVIRONMENT_IN_USE', message: expect.stringContaining('schedule'),
    });
    expect(await db.select().from(environmentSpec)).toHaveLength(1); // not deleted
  } finally { await close(); }
});
