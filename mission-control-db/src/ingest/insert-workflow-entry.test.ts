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
import { workCenter, workflow, workflowNode, workflowUiStep } from '../db/schema/index.js';
import { insertWorkflowEntry } from './insert-workflow-entry.js';

const spec = (over: Record<string, unknown> = {}) => ({
  local_id: 'Mix', oid: 'w1',
  steps: [
    { local_id: 'Begin', oid: 's0', step_type: 'START' },
    { local_id: 'Do it', oid: 's1', step_type: 'USER_INTERACTION' },
  ],
  children: [
    { local_id: 'Sub', oid: 'w1-c1', steps: [{ local_id: 'Confirm', oid: 's2', step_type: 'YES_NO' }] },
  ],
  ...over,
});

test('insertWorkflowEntry inserts the row and indexes the node tree', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line' }).returning();

    const res = await insertWorkflowEntry(db, spec(), {
      workCenterId: wc.id, version: '1.0.0', state: 'Effective',
    });

    expect(res.status).toBe('inserted');
    expect(res.nodeCount).toBe(2);      // root + one child
    expect(res.uiStepCount).toBe(2);    // START is not a UI step
    const [row] = await db.select().from(workflow).where(eq(workflow.id, res.workflowId));
    expect(row.name).toBe('Mix');
    expect(row.specJsonb).toEqual(spec());
  } finally { await close(); }
});

// The M6 no-op rule, inherited rather than re-solved: (work_center_id, oid, version, state).
test('insertWorkflowEntry reports already_present for a colliding entry', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    const meta = { workCenterId: wc.id, version: '1.0.0', state: 'Effective' };
    const first = await insertWorkflowEntry(db, spec(), meta);
    const second = await insertWorkflowEntry(db, spec(), meta);

    expect(second.status).toBe('already_present');
    expect(second.workflowId).toBe(first.workflowId);
    expect(await db.select().from(workflow)).toHaveLength(1);
    expect(await db.select().from(workflowNode)).toHaveLength(2); // not re-indexed
  } finally { await close(); }
});

// Same oid at a different version is a DIFFERENT entry — the business key includes version.
test('insertWorkflowEntry treats a new version of the same oid as a separate entry', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    await insertWorkflowEntry(db, spec(), { workCenterId: wc.id, version: '1.0.0', state: 'Effective' });
    await insertWorkflowEntry(db, spec(), { workCenterId: wc.id, version: '2.0.0', state: 'Effective' });
    expect(await db.select().from(workflow)).toHaveLength(2);
  } finally { await close(); }
});

test('insertWorkflowEntry carries the row columns the manifest supplies', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    const res = await insertWorkflowEntry(db, spec(), {
      workCenterId: wc.id, version: '1.0.0', state: 'Draft',
      dispatchPolicy: 'manual', sourceLibraryName: 'Studio', sourceLibraryOid: 'lib-1',
      sourceFilename: 'mix.WFmasterX', checksum: 'abc',
    });
    const [row] = await db.select().from(workflow).where(eq(workflow.id, res.workflowId));
    expect(row).toMatchObject({
      dispatchPolicy: 'manual', sourceLibraryName: 'Studio', sourceLibraryOid: 'lib-1',
      sourceFilename: 'mix.WFmasterX', checksum: 'abc', state: 'Draft',
    });
  } finally { await close(); }
});

// D8. This is the property that makes import safe: the function must not reach for a prior
// entry's config. A version that called carryOverConfig would give v2 v1's policy here.
test('insertWorkflowEntry does NOT carry configuration over from a prior entry', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    await insertWorkflowEntry(db, spec(), {
      workCenterId: wc.id, version: '1.0.0', state: 'Effective', dispatchPolicy: 'manual',
    });
    const second = await insertWorkflowEntry(db, spec(), {
      workCenterId: wc.id, version: '2.0.0', state: 'Effective',   // no dispatchPolicy given
    });
    const [row] = await db.select().from(workflow).where(eq(workflow.id, second.workflowId));
    expect(row.dispatchPolicy).toBeNull();
  } finally { await close(); }
});

// REGRESSION GUARD (spec §8.5.2). WFcenterX merge needs an already-present entry's dispatch
// override overwritten, and the tempting place to do that is right here — which would silently
// change /load so that re-loading a .WFmasterX clobbers an override a steward set by hand.
// Merge does its own narrow update in package/import.ts instead. If this test fails, that
// decision was reversed: revert it rather than updating this assertion.
test('insertWorkflowEntry never updates an existing row, whatever meta it is handed', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
    const meta = { workCenterId: wc.id, version: '1.0.0', state: 'Effective' };
    await insertWorkflowEntry(db, spec(), { ...meta, dispatchPolicy: 'manual' });

    const second = await insertWorkflowEntry(db, spec(), { ...meta, dispatchPolicy: 'round_robin' });

    expect(second.status).toBe('already_present');
    const [row] = await db.select().from(workflow);
    expect(row.dispatchPolicy).toBe('manual');   // NOT the second call's value
  } finally { await close(); }
});

test('insertWorkflowEntry indexes only UI step types', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    const res = await insertWorkflowEntry(db, spec(), {
      workCenterId: wc.id, version: '1.0.0', state: 'Effective',
    });
    const steps = await db.select().from(workflowUiStep).where(eq(workflowUiStep.workflowId, res.workflowId));
    expect(steps.map((s) => s.stepType).sort()).toEqual(['USER_INTERACTION', 'YES_NO']);
  } finally { await close(); }
});

test('insertWorkflowEntry stores the root type_name leniently', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line' }).returning();
    const typeOf = async (over: Record<string, unknown>, oid: string) => {
      const res = await insertWorkflowEntry(db, spec({ oid, ...over }), {
        workCenterId: wc.id, version: '1.0.0', state: 'Effective',
      });
      expect(res.status).toBe('inserted');
      const [row] = await db.select().from(workflow).where(eq(workflow.id, res.workflowId));
      return row.typeName;
    };
    expect(await typeOf({ type_name: ' Operation ' }, 'a')).toBe('Operation');
    expect(await typeOf({}, 'b')).toBeNull();
    expect(await typeOf({ type_name: 7 }, 'c')).toBeNull();
    expect(await typeOf({ type_name: 'x'.repeat(51) }, 'd')).toBeNull();
  } finally { await close(); }
});
