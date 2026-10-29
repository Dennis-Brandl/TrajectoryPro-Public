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
import { workCenter, environmentSpec, wcValueProperty } from '../db/schema/index.js';
import { materializeEnvironmentRegistry } from './work-center-runtime.js';
import { MAX_NAME_LENGTH } from './names.js';

const recipeSpec = {
  value_property_specifications: [
    { name: 'Recipe', entries: [
      { name: 'Target', value: '80' },
      { name: 'Tolerance', value: '2' },
      { name: 'Description', value: 'fill parameters' },
    ] },
  ],
};

async function load(db: any, wcId: string, spec: unknown, over: Partial<{ version: string; state: string; at: string; name: string }> = {}) {
  const [env] = await db.insert(environmentSpec).values({
    oid: 'env-1', name: 'DemoLine', workCenterId: wcId,
    version: over.version ?? '1.0.0', state: over.state ?? 'Draft', specJsonb: spec as any,
  }).returning();
  return materializeEnvironmentRegistry(db, {
    workCenterId: wcId, envSpecId: env.id, envSpecName: over.name ?? 'DemoLine',
    version: over.version ?? '1.0.0', state: over.state ?? 'Draft',
    downloadedAt: new Date(over.at ?? '2026-08-01'), specJsonb: spec,
  });
}

test('a first load seeds every entry, including the Description annotation entry', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    await load(db, wc.id, recipeSpec);
    const rows = await db.select().from(wcValueProperty);
    expect(rows).toHaveLength(3);
    const byEntry = Object.fromEntries(rows.map((r: any) => [r.entryName, r.value]));
    expect(byEntry).toEqual({ Target: '80', Tolerance: '2', Description: 'fill parameters' });
  } finally { await close(); }
});

test('re-loading NEVER overwrites a live value', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    await load(db, wc.id, recipeSpec);
    // A running workflow (or an operator) moved the value.
    await db.update(wcValueProperty).set({ value: '95' })
      .where(and(eq(wcValueProperty.propertyName, 'Recipe'), eq(wcValueProperty.entryName, 'Target')));

    await load(db, wc.id, recipeSpec, { version: '2.0.0', state: 'Effective', at: '2026-08-02' });

    const [row] = await db.select().from(wcValueProperty)
      .where(and(eq(wcValueProperty.propertyName, 'Recipe'), eq(wcValueProperty.entryName, 'Target')));
    expect(row.value).toBe('95');
  } finally { await close(); }
});

test('a later load adds newly-declared entries without disturbing existing ones', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    await load(db, wc.id, recipeSpec);
    await db.update(wcValueProperty).set({ value: '95' })
      .where(and(eq(wcValueProperty.propertyName, 'Recipe'), eq(wcValueProperty.entryName, 'Target')));

    const extended = { value_property_specifications: [
      { name: 'Recipe', entries: [
        { name: 'Target', value: '80' },
        { name: 'Tolerance', value: '2' },
        { name: 'Description', value: 'fill parameters' },
        { name: 'RampRate', value: '5' },
      ] },
    ] };
    await load(db, wc.id, extended, { version: '2.0.0', at: '2026-08-02' });

    const rows = await db.select().from(wcValueProperty);
    expect(rows).toHaveLength(4);
    const byEntry = Object.fromEntries(rows.map((r: any) => [r.entryName, r.value]));
    expect(byEntry.RampRate).toBe('5');
    expect(byEntry.Target).toBe('95');
  } finally { await close(); }
});

test('two environments in one work center share the value-property name space', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    await load(db, wc.id, { value_property_specifications: [
      { name: 'Recipe', entries: [{ name: 'Target', value: '80' }] },
    ] }, { name: 'EnvA' });
    // EnvB declares the same Recipe.Target with a different seed value. The first seed
    // stands: the entry already exists and a load never overwrites a value.
    await load(db, wc.id, { value_property_specifications: [
      { name: 'Recipe', entries: [{ name: 'Target', value: '42' }] },
    ] }, { name: 'EnvB', version: '2.0.0', at: '2026-08-02' });

    const rows = await db.select().from(wcValueProperty);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe('80');
  } finally { await close(); }
});

test('a property with no entries array is skipped without throwing', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const { warnings } = await load(db, wc.id, {
      value_property_specifications: [{ name: 'Empty' }, { name: 'Recipe', entries: [{ name: 'Target', value: '1' }] }],
    });
    expect(warnings).toEqual([]);
    expect(await db.select().from(wcValueProperty)).toHaveLength(1);
  } finally { await close(); }
});

test('entries present but not an array is skipped with a warning and does not throw', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const { warnings } = await load(db, wc.id, {
      value_property_specifications: [{ name: 'Recipe', entries: {} }],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Recipe');
    expect(await db.select().from(wcValueProperty)).toHaveLength(0);
  } finally { await close(); }
});

test('a malformed value property does not poison a valid sibling in the same load', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const { warnings } = await load(db, wc.id, {
      value_property_specifications: [
        { name: 'Bad', entries: {} },
        { name: 'Recipe', entries: [{ name: 'Target', value: '80' }] },
      ],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Bad');
    const rows = await db.select().from(wcValueProperty);
    expect(rows).toHaveLength(1);
    expect(rows[0].propertyName).toBe('Recipe');
    expect(rows[0].value).toBe('80');
  } finally { await close(); }
});

// --- m1: a malformed name must warn end-to-end through materialize, too -------------------

test('a value property declaration with a non-string name warns instead of silently vanishing', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const { warnings } = await load(db, wc.id, {
      value_property_specifications: [
        { name: 42, entries: [{ name: 'Target', value: '1' }] },
        { entries: [{ name: 'Target', value: '1' }] },
        { name: 'Recipe', entries: [{ name: 'Target', value: '80' }] },
      ],
    });
    expect(warnings).toHaveLength(2);
    const rows = await db.select().from(wcValueProperty);
    expect(rows).toHaveLength(1);
    expect(rows[0].propertyName).toBe('Recipe');
  } finally { await close(); }
});

// --- m6: an over-long property or entry name must never reach the insert ------------------

test('an over-long value-property name is skipped with a warning and does not throw', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const longName = 'Y'.repeat(MAX_NAME_LENGTH + 1);
    const { warnings } = await load(db, wc.id, {
      value_property_specifications: [{ name: longName, entries: [{ name: 'Target', value: '1' }] }],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('exceeds');
    expect(await db.select().from(wcValueProperty)).toHaveLength(0);
  } finally { await close(); }
});

test('an over-long entry name is skipped with a warning and does not throw', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const longName = 'Z'.repeat(MAX_NAME_LENGTH + 1);
    const { warnings } = await load(db, wc.id, {
      value_property_specifications: [{ name: 'Recipe', entries: [{ name: longName, value: '1' }] }],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('exceeds');
    expect(await db.select().from(wcValueProperty)).toHaveLength(0);
  } finally { await close(); }
});

test('a value property declared in a different work center stays separate', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [a] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const [b] = await db.insert(workCenter).values({ name: 'Line 2' }).returning();
    await load(db, a.id, recipeSpec);
    await load(db, b.id, recipeSpec);
    expect(await db.select().from(wcValueProperty)).toHaveLength(6);
  } finally { await close(); }
});
