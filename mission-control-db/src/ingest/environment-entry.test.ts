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
import { environmentSpec, workCenter, workflow, workflowEnvironment } from '../db/schema/index.js';
import { upsertEnvironmentSpec, propagateEnvironmentToWorkflows, nestedEnvironmentSpecs } from './environment-entry.js';

const env = (uri: string, extra: any = {}) => ({
  oid: 'env-1', local_id: 'Line Env', version: '1.0.0', state: 'Draft', included_actions: [],
  action_server_specifications: [{ name: 'AS', uri }], ...extra,
});

async function setup() {
  const t = await makeTestDb();
  const [wc] = await t.db.insert(workCenter).values({ name: 'Line 1' }).returning();
  return { ...t, wc };
}

test('a changed Draft environment at the same version is replaced in place', async () => {
  const { db, close, wc } = await setup();
  try {
    const first = await upsertEnvironmentSpec(db, env('http://old'), { workCenterId: wc.id });
    const second = await upsertEnvironmentSpec(db, env('http://new'), { workCenterId: wc.id });
    expect(first.status).toBe('loaded');
    expect(second.status).toBe('replaced');
    expect(second.id).toBe(first.id);
    const rows = await db.select().from(environmentSpec);
    expect(rows).toHaveLength(1);
    expect((rows[0].specJsonb as any).action_server_specifications[0].uri).toBe('http://new');
  } finally { await close(); }
});

test('an identical environment stays already_present and is not rewritten', async () => {
  const { db, close, wc } = await setup();
  try {
    const first = await upsertEnvironmentSpec(db, env('http://old'), { workCenterId: wc.id });
    // Same content, different key order: jsonb equality must still call it unchanged.
    const reordered = { action_server_specifications: [{ uri: 'http://old', name: 'AS' }], included_actions: [],
      state: 'Draft', version: '1.0.0', local_id: 'Line Env', oid: 'env-1' };
    const again = await upsertEnvironmentSpec(db, reordered, { workCenterId: wc.id });
    expect(again.status).toBe('already_present');
    expect(again.id).toBe(first.id);
    const [row] = await db.select().from(environmentSpec);
    expect(row.downloadedAt.getTime()).toBe(first.downloadedAt.getTime());
  } finally { await close(); }
});

test('a released environment is never replaced', async () => {
  const { db, close, wc } = await setup();
  try {
    await upsertEnvironmentSpec(db, env('http://old', { state: 'Effective' }), { workCenterId: wc.id });
    const again = await upsertEnvironmentSpec(db, env('http://new', { state: 'Effective' }), { workCenterId: wc.id });
    expect(again.status).toBe('already_present');
    const [row] = await db.select().from(environmentSpec);
    expect((row.specJsonb as any).action_server_specifications[0].uri).toBe('http://old');
  } finally { await close(); }
});

test('Draft and InTest copies of one version are independent', async () => {
  const { db, close, wc } = await setup();
  try {
    await upsertEnvironmentSpec(db, env('http://d'), { workCenterId: wc.id });
    await upsertEnvironmentSpec(db, env('http://t', { state: 'InTest' }), { workCenterId: wc.id });
    const r = await upsertEnvironmentSpec(db, env('http://d2'), { workCenterId: wc.id });
    expect(r.status).toBe('replaced');
    const [inTest] = await db.select().from(environmentSpec).where(eq(environmentSpec.state, 'InTest'));
    expect((inTest.specJsonb as any).action_server_specifications[0].uri).toBe('http://t');
  } finally { await close(); }
});

test('propagation updates linked editable workflows at every depth and skips released ones', async () => {
  const { db, close, wc } = await setup();
  try {
    const old = env('http://old');
    const next = env('http://new');
    const { id: envId } = await upsertEnvironmentSpec(db, old, { workCenterId: wc.id });
    const mk = async (name: string, state: string, spec: any) => {
      const [w] = await db.insert(workflow).values({
        oid: `wf-${name}`, name, workCenterId: wc.id, version: '1.0.0', state, specJsonb: spec,
      }).returning();
      await db.insert(workflowEnvironment).values({ workflowId: w.id, environmentSpecId: envId });
      return w;
    };
    const a = await mk('A', 'Draft', { local_id: 'A', environment_specifications: [old, { oid: 'other', local_id: 'Other' }] });
    const b = await mk('B', 'InReview', { local_id: 'B', children: [{ local_id: 'c', environment_specifications: [old] }] });
    const c = await mk('C', 'Effective', { local_id: 'C', environment_specifications: [old] });

    const names = await propagateEnvironmentToWorkflows(db, envId, next);
    expect(names).toEqual(['A', 'B']);

    const get = async (id: string) => (await db.select().from(workflow).where(eq(workflow.id, id)))[0].specJsonb as any;
    const ga = await get(a.id);
    expect(ga.environment_specifications[0]).toEqual(next);
    expect(ga.environment_specifications[1]).toEqual({ oid: 'other', local_id: 'Other' });
    expect((await get(b.id)).children[0].environment_specifications[0]).toEqual(next);
    expect(await get(c.id)).toEqual({ local_id: 'C', environment_specifications: [old] });
  } finally { await close(); }
});

test('nestedEnvironmentSpecs lists env specs on the root and every nested child, in walk order', () => {
  const spec = {
    environment_specifications: [{ oid: 'r' }],
    children: [
      { environment_specifications: [{ oid: 'c1' }], children: [{ environment_specifications: [{ oid: 'g1' }] }] },
      { environment_specifications: [{ oid: 'c2' }] },
    ],
  };
  expect(nestedEnvironmentSpecs(spec).map((e) => e.oid)).toEqual(['r', 'c1', 'g1', 'c2']);
  expect(nestedEnvironmentSpecs({})).toEqual([]);
});
