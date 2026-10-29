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
import { and, eq } from 'drizzle-orm';
import { makeTestDb } from '../../test/helpers/db.js';
import { workCenter, appUser, wcValueProperty } from '../db/schema/index.js';
import { loadSharedValueProperties, writeSharedValueProperties, writeSharedValueProperty } from './wc-value-properties.js';

async function seed(db: any) {
  const [a] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
  const [b] = await db.insert(workCenter).values({ name: 'Line 2' }).returning();
  await db.insert(wcValueProperty).values([
    { workCenterId: a.id, propertyName: 'Recipe', entryName: 'Target', value: '80' },
    { workCenterId: a.id, propertyName: 'Recipe', entryName: 'Tolerance', value: '2' },
    { workCenterId: a.id, propertyName: 'Line', entryName: 'Speed', value: '10' },
    { workCenterId: b.id, propertyName: 'Recipe', entryName: 'Target', value: '999' },
  ]);
  return { a, b };
}

test('loadSharedValueProperties returns only the given work center rows', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { a } = await seed(db);
    const rows = await loadSharedValueProperties(db, a.id);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.value !== '999')).toBe(true);
    expect(rows.find((r) => r.propertyName === 'Recipe' && r.entryName === 'Target')?.value).toBe('80');
  } finally { await close(); }
});

test('loadSharedValueProperties returns empty for a work center with no rows', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Empty' }).returning();
    expect(await loadSharedValueProperties(db, wc.id)).toEqual([]);
  } finally { await close(); }
});

test('writeSharedValueProperties updates values and stamps updated_at, clearing updated_by', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { a } = await seed(db);
    const [user] = await db.insert(appUser).values({
      email: 'op@example.com', displayName: 'Op', accessLevel: 'administrator',
    }).returning();
    // Simulate a prior operator edit, so we can prove an engine write clears the attribution.
    await db.update(wcValueProperty).set({ updatedBy: user.id })
      .where(and(eq(wcValueProperty.workCenterId, a.id), eq(wcValueProperty.propertyName, 'Recipe')));

    const at = new Date('2026-09-01T10:00:00Z');
    const matched = await writeSharedValueProperties(db, a.id, [
      { propertyName: 'Recipe', entryName: 'Target', value: '95' },
    ], at);

    expect(matched).toBe(1);
    const [row] = await db.select().from(wcValueProperty).where(and(
      eq(wcValueProperty.workCenterId, a.id),
      eq(wcValueProperty.propertyName, 'Recipe'),
      eq(wcValueProperty.entryName, 'Target'),
    ));
    expect(row.value).toBe('95');
    expect(row.updatedAt.toISOString()).toBe(at.toISOString());
    // The engine, not a person, made this write — the prior attribution must not survive it.
    expect(row.updatedBy).toBeNull();
  } finally { await close(); }
});

test('writeSharedValueProperties never touches another work center row with the same key', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { a, b } = await seed(db);
    await writeSharedValueProperties(db, a.id, [
      { propertyName: 'Recipe', entryName: 'Target', value: '1' },
    ], new Date());
    const [other] = await db.select().from(wcValueProperty).where(and(
      eq(wcValueProperty.workCenterId, b.id), eq(wcValueProperty.propertyName, 'Recipe'),
    ));
    expect(other.value).toBe('999');
  } finally { await close(); }
});

test('writing an entry that does not exist matches nothing and does not throw', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { a } = await seed(db);
    const matched = await writeSharedValueProperties(db, a.id, [
      { propertyName: 'Recipe', entryName: 'NeverDeclared', value: 'x' },
    ], new Date());
    expect(matched).toBe(0);
    expect(await db.select().from(wcValueProperty)).toHaveLength(4); // nothing inserted
  } finally { await close(); }
});

test('an empty update list is a no-op', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { a } = await seed(db);
    expect(await writeSharedValueProperties(db, a.id, [], new Date())).toBe(0);
  } finally { await close(); }
});

test('writeSharedValueProperty stamps updated_by with the actor and reports a miss', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const [user] = await db.insert(appUser).values({ email: 'op-p4a@example.test', displayName: 'Op' }).returning();
    await db.insert(wcValueProperty).values({ workCenterId: wc.id, propertyName: 'Batch', entryName: 'Size', value: '5' });
    const at = new Date('2026-09-02T12:00:00Z');
    expect(await writeSharedValueProperty(db, wc.id, { propertyName: 'Batch', entryName: 'Size', value: '7' }, at, user.id)).toBe(true);
    const [row] = await db.select().from(wcValueProperty).where(eq(wcValueProperty.workCenterId, wc.id));
    expect([row.value, row.updatedBy, row.updatedAt.toISOString()]).toEqual(['7', user.id, at.toISOString()]);
    expect(await writeSharedValueProperty(db, wc.id, { propertyName: 'Batch', entryName: 'Nope', value: '1' }, at, user.id)).toBe(false);
    // An engine write afterwards clears the attribution again (existing contract, pinned here
    // because the two writers now share a row).
    await writeSharedValueProperties(db, wc.id, [{ propertyName: 'Batch', entryName: 'Size', value: '9' }], new Date());
    const [after] = await db.select().from(wcValueProperty).where(eq(wcValueProperty.workCenterId, wc.id));
    expect([after.value, after.updatedBy]).toEqual(['9', null]);
  } finally { await close(); }
});
