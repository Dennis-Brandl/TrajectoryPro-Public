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
import { workCenter, environmentSpec, wcValueProperty, appUser } from '../db/schema/index.js';
import { listWorkCenterValueProperties, listEnvironmentValueProperties, isAnnotationEntry } from './shared-state.js';

async function seed(db: any) {
  const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
  const [env] = await db.insert(environmentSpec).values({
    oid: 'env-1', name: 'Kitchen', workCenterId: wc.id, version: '1.0.0', state: 'Effective',
    specJsonb: { value_property_specifications: [
      { name: 'Batch', entries: [{ name: 'Size', value: '5' }, { name: 'Missing', value: '' }] },
    ] },
  }).returning();
  const [user] = await db.insert(appUser).values({ email: 'c@x.io', displayName: 'Cmdr' }).returning();
  const value = (values: Record<string, unknown>) => db.insert(wcValueProperty).values({ workCenterId: wc.id, definedByEnvSpecId: env.id, ...values });
  return { wc, env, user, value };
}

test('isAnnotationEntry matches the engine spelling of the Description rule (case-insensitive)', () => {
  expect(isAnnotationEntry('Description')).toBe(true);
  expect(isAnnotationEntry('description')).toBe(true);
  expect(isAnnotationEntry('Descriptions')).toBe(false);
});

test('lists every entry ordered by property then entry, with annotation, orphaned and updated-by', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wc, env, user, value } = await seed(db);
    await value({ propertyName: 'Batch', entryName: 'Size', value: '5' });
    await value({ propertyName: 'Batch', entryName: 'Description', value: 'Batch settings' });
    await value({ propertyName: 'Alarm', entryName: 'Limit', value: '90', updatedBy: user.id });
    await value({ propertyName: 'Zed', entryName: 'A', value: '', definedByEnvSpecId: null });

    const rows = (await listWorkCenterValueProperties(db, wc.id))!;
    expect(rows.map((r) => `${r.propertyName}.${r.entryName}`)).toEqual(['Alarm.Limit', 'Batch.Description', 'Batch.Size', 'Zed.A']);
    expect(rows[0]).toMatchObject({ value: '90', updatedByName: 'Cmdr', annotation: false, orphaned: false, definedByEnvSpecId: env.id });
    expect(rows[0].updatedAt).toBeInstanceOf(Date);
    expect(rows[1]).toMatchObject({ annotation: true, updatedByName: null });
    expect(rows[3]).toMatchObject({ orphaned: true, definedByEnvSpecId: null });
    expect(await listWorkCenterValueProperties(db, '00000000-0000-0000-0000-000000000000')).toBeUndefined();
  } finally { await close(); }
});

test('the environment view keeps every entry of a declared property and lists unregistered pairs', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wc, env, value } = await seed(db);
    await value({ propertyName: 'Batch', entryName: 'Size', value: '5' });
    await value({ propertyName: 'Batch', entryName: 'Colour', value: 'red' }); // added by another spec: same flat namespace, still shown
    await value({ propertyName: 'Other', entryName: 'X', value: '1' });        // not declared here
    const view = (await listEnvironmentValueProperties(db, env.id))!;
    expect(view.workCenterId).toBe(wc.id);
    expect(view.values.map((v) => v.entryName)).toEqual(['Colour', 'Size']);
    expect(view.unregistered).toEqual([{ propertyName: 'Batch', entryName: 'Missing' }]);
    await db.delete(environmentSpec).where(eq(environmentSpec.id, env.id));
    expect(await listEnvironmentValueProperties(db, env.id)).toBeUndefined();
  } finally { await close(); }
});

test('a malformed declaration (non-array entries, non-string entry name) does not throw and contributes nothing to unregistered', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 2' }).returning();
    const [env] = await db.insert(environmentSpec).values({
      oid: 'env-2', name: 'Bad Kitchen', workCenterId: wc.id, version: '1.0.0', state: 'Effective',
      specJsonb: { value_property_specifications: [
        { name: 'Bad', entries: 'bogus' },
        { name: 'Weird', entries: [{ name: 123, value: 'x' }] },
      ] },
    }).returning();
    const view = (await listEnvironmentValueProperties(db, env.id))!;
    expect(view.unregistered).toEqual([]);
  } finally { await close(); }
});

test('the same declared property/entry pair repeated across declarations appears once in unregistered', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 3' }).returning();
    const [env] = await db.insert(environmentSpec).values({
      oid: 'env-3', name: 'Dup Kitchen', workCenterId: wc.id, version: '1.0.0', state: 'Effective',
      specJsonb: { value_property_specifications: [
        { name: 'Batch', entries: [{ name: 'Missing', value: '' }] },
        { name: 'Batch', entries: [{ name: 'Missing', value: '' }] },
      ] },
    }).returning();
    const view = (await listEnvironmentValueProperties(db, env.id))!;
    expect(view.unregistered).toEqual([{ propertyName: 'Batch', entryName: 'Missing' }]);
  } finally { await close(); }
});
