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
import { workCenter, environmentSpec, wcResource } from '../db/schema/index.js';
import { materializeEnvironmentRegistry, readRegistrySource } from './work-center-runtime.js';
import { MAX_NAME_LENGTH } from './names.js';

async function makeEnv(db: any, opts: { wcId: string; oid?: string; version?: string; state?: string; name?: string; spec: unknown }) {
  const [row] = await db.insert(environmentSpec).values({
    oid: opts.oid ?? 'env-1', name: opts.name ?? 'DemoLine', workCenterId: opts.wcId,
    version: opts.version ?? '1.0.0', state: opts.state ?? 'Draft', specJsonb: opts.spec as any,
  }).returning();
  return row;
}

const printerSpec = (over: Record<string, unknown> = {}) => ({
  local_id: 'DemoLine', oid: 'env-1',
  resource_property_specifications: [
    { name: 'Printer', resource_type: 'binary exclusive use', description: 'label printer', ...over },
  ],
});

test('readRegistrySource tolerates a spec with neither array', () => {
  expect(readRegistrySource({})).toEqual({ resources: [], valueProperties: [], warnings: [] });
  expect(readRegistrySource(null)).toEqual({ resources: [], valueProperties: [], warnings: [] });
  expect(readRegistrySource('nonsense')).toEqual({ resources: [], valueProperties: [], warnings: [] });
});

test('readRegistrySource warns (rather than silently dropping) a declaration with a non-string name or resource_type', () => {
  const { resources, warnings } = readRegistrySource({
    resource_property_specifications: [
      { name: 123, resource_type: 'binary exclusive use' },
      { resource_type: 'binary exclusive use' },
      { name: 'NoType' },
      { name: 'Printer', resource_type: 'binary exclusive use' },
    ],
  });
  expect(resources).toEqual([{ name: 'Printer', resource_type: 'binary exclusive use' }]);
  expect(warnings).toHaveLength(3);
});

test('a first load inserts the definition with provenance and empty live state', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const env = await makeEnv(db, { wcId: wc.id, state: 'Effective', spec: printerSpec() });
    const { warnings } = await materializeEnvironmentRegistry(db, {
      workCenterId: wc.id, envSpecId: env.id, envSpecName: 'DemoLine',
      version: '1.0.0', state: 'Effective', downloadedAt: new Date('2026-08-01'),
      specJsonb: env.specJsonb,
    });
    expect(warnings).toEqual([]);
    const [row] = await db.select().from(wcResource);
    expect(row.name).toBe('Printer');
    expect(row.resourceType).toBe('binary exclusive use');
    expect(row.description).toBe('label printer');
    expect(row.inUse).toBe(0);
    expect(row.definedByEnvSpecId).toBe(env.id);
    expect(row.definedFromState).toBe('Effective');
  } finally { await close(); }
});

test('a named pool starts fully available', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const spec = { resource_property_specifications: [
      { name: 'Bay', resource_type: 'named pool', names: ['B1', 'B2', 'B3'] },
    ] };
    const env = await makeEnv(db, { wcId: wc.id, spec });
    await materializeEnvironmentRegistry(db, {
      workCenterId: wc.id, envSpecId: env.id, envSpecName: 'DemoLine',
      version: '1.0.0', state: 'Draft', downloadedAt: new Date('2026-08-01'), specJsonb: spec,
    });
    const [row] = await db.select().from(wcResource);
    expect(row.poolNames).toEqual(['B1', 'B2', 'B3']);
    expect(row.availableNames).toEqual(['B1', 'B2', 'B3']);
  } finally { await close(); }
});

test('re-loading the same definition is a no-op and warns nothing', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const env = await makeEnv(db, { wcId: wc.id, spec: printerSpec() });
    const input = {
      workCenterId: wc.id, envSpecId: env.id, envSpecName: 'DemoLine',
      version: '1.0.0', state: 'Draft', downloadedAt: new Date('2026-08-01'),
      specJsonb: env.specJsonb,
    };
    await materializeEnvironmentRegistry(db, input);
    // Simulate live state accrued between loads.
    await db.update(wcResource).set({ inUse: 1 }).where(eq(wcResource.name, 'Printer'));
    const { warnings } = await materializeEnvironmentRegistry(db, input);
    expect(warnings).toEqual([]);
    const [row] = await db.select().from(wcResource);
    expect(row.inUse).toBe(1); // live state is never touched by a load
  } finally { await close(); }
});

test('a conflicting redeclaration from a higher-ranked spec wins, warns, and keeps live counters', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const draftSpec = printerSpec();
    const draft = await makeEnv(db, { wcId: wc.id, oid: 'env-a', name: 'EnvA', state: 'Draft', spec: draftSpec });
    await materializeEnvironmentRegistry(db, {
      workCenterId: wc.id, envSpecId: draft.id, envSpecName: 'EnvA',
      version: '1.0.0', state: 'Draft', downloadedAt: new Date('2026-08-01'), specJsonb: draftSpec,
    });
    await db.update(wcResource).set({ inUse: 3 }).where(eq(wcResource.name, 'Printer'));

    const effSpec = { resource_property_specifications: [
      { name: 'Printer', resource_type: 'countable use with pool limits', use_limit: 5 },
    ] };
    const eff = await makeEnv(db, { wcId: wc.id, oid: 'env-b', name: 'EnvB', state: 'Effective', spec: effSpec });
    const { warnings } = await materializeEnvironmentRegistry(db, {
      workCenterId: wc.id, envSpecId: eff.id, envSpecName: 'EnvB',
      version: '1.0.0', state: 'Effective', downloadedAt: new Date('2026-08-02'), specJsonb: effSpec,
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Printer');
    // The warning must name BOTH specs and BOTH definitions (spec §2 U3, §4.6) — the
    // incumbent's name is recovered via a live lookup of environment_spec.name through
    // definedByEnvSpecId, since the declaring spec (EnvA) still exists at this point.
    expect(warnings[0]).toContain('EnvA');
    expect(warnings[0]).toContain('EnvB');
    expect(warnings[0]).toContain('binary exclusive use');
    expect(warnings[0]).toContain('countable use with pool limits');
    const [row] = await db.select().from(wcResource);
    expect(row.resourceType).toBe('countable use with pool limits');
    expect(row.useLimit).toBe(5);
    expect(row.definedByEnvSpecId).toBe(eff.id);
    expect(row.inUse).toBe(3); // live state survives a definition change
  } finally { await close(); }
});

test('a conflicting redeclaration from a lower-ranked spec warns but does not displace', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const effSpec = printerSpec();
    const eff = await makeEnv(db, { wcId: wc.id, oid: 'env-b', name: 'EnvB', state: 'Effective', spec: effSpec });
    await materializeEnvironmentRegistry(db, {
      workCenterId: wc.id, envSpecId: eff.id, envSpecName: 'EnvB',
      version: '2.0.0', state: 'Effective', downloadedAt: new Date('2026-08-02'), specJsonb: effSpec,
    });

    const draftSpec = { resource_property_specifications: [
      { name: 'Printer', resource_type: 'named pool', names: ['P1'] },
    ] };
    const draft = await makeEnv(db, { wcId: wc.id, oid: 'env-a', name: 'EnvA', state: 'Draft', spec: draftSpec });
    const { warnings } = await materializeEnvironmentRegistry(db, {
      workCenterId: wc.id, envSpecId: draft.id, envSpecName: 'EnvA',
      version: '1.0.0', state: 'Draft', downloadedAt: new Date('2026-08-03'), specJsonb: draftSpec,
    });

    expect(warnings).toHaveLength(1);
    const [row] = await db.select().from(wcResource);
    expect(row.resourceType).toBe('binary exclusive use');
    expect(row.definedByEnvSpecId).toBe(eff.id);
  } finally { await close(); }
});

test('shrinking use_limit below in_use leaves the pool over-committed rather than truncating', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const big = { resource_property_specifications: [
      { name: 'Slots', resource_type: 'countable use with pool limits', use_limit: 10 },
    ] };
    const envBig = await makeEnv(db, { wcId: wc.id, oid: 'env-a', name: 'EnvA', state: 'Effective', spec: big });
    await materializeEnvironmentRegistry(db, {
      workCenterId: wc.id, envSpecId: envBig.id, envSpecName: 'EnvA',
      version: '1.0.0', state: 'Effective', downloadedAt: new Date('2026-08-01'), specJsonb: big,
    });
    await db.update(wcResource).set({ inUse: 8 }).where(eq(wcResource.name, 'Slots'));

    const small = { resource_property_specifications: [
      { name: 'Slots', resource_type: 'countable use with pool limits', use_limit: 4 },
    ] };
    const envSmall = await makeEnv(db, { wcId: wc.id, oid: 'env-a', name: 'EnvA', version: '2.0.0', state: 'Effective', spec: small });
    await materializeEnvironmentRegistry(db, {
      workCenterId: wc.id, envSpecId: envSmall.id, envSpecName: 'EnvA',
      version: '2.0.0', state: 'Effective', downloadedAt: new Date('2026-08-02'), specJsonb: small,
    });

    const [row] = await db.select().from(wcResource);
    expect(row.useLimit).toBe(4);
    expect(row.inUse).toBe(8); // over-committed, surfaced by the UI rather than silently fixed
  } finally { await close(); }
});

test('a shrunk pool roster keeps held names out of both arrays so release discards them', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const three = { resource_property_specifications: [
      { name: 'Bay', resource_type: 'named pool', names: ['B1', 'B2', 'B3'] },
    ] };
    const envA = await makeEnv(db, { wcId: wc.id, oid: 'env-a', name: 'EnvA', state: 'Effective', spec: three });
    await materializeEnvironmentRegistry(db, {
      workCenterId: wc.id, envSpecId: envA.id, envSpecName: 'EnvA',
      version: '1.0.0', state: 'Effective', downloadedAt: new Date('2026-08-01'), specJsonb: three,
    });
    // B2 is held: it is in the roster but not available.
    await db.update(wcResource).set({ availableNames: ['B1', 'B3'] }).where(eq(wcResource.name, 'Bay'));

    // New roster drops the held B2 and adds B4.
    const next = { resource_property_specifications: [
      { name: 'Bay', resource_type: 'named pool', names: ['B1', 'B3', 'B4'] },
    ] };
    const envB = await makeEnv(db, { wcId: wc.id, oid: 'env-a', name: 'EnvA', version: '2.0.0', state: 'Effective', spec: next });
    await materializeEnvironmentRegistry(db, {
      workCenterId: wc.id, envSpecId: envB.id, envSpecName: 'EnvA',
      version: '2.0.0', state: 'Effective', downloadedAt: new Date('2026-08-02'), specJsonb: next,
    });

    const [row] = await db.select().from(wcResource);
    expect(row.poolNames).toEqual(['B1', 'B3', 'B4']);
    // B4 joins as free; B1/B3 stay free; B2 is in NEITHER array -> releaseNamed discards it.
    expect([...row.availableNames].sort()).toEqual(['B1', 'B3', 'B4']);
    expect(row.poolNames).not.toContain('B2');
  } finally { await close(); }
});

test('an orphaned incumbent (declaring spec deleted) can still be outranked', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const oldSpec = printerSpec();
    const gone = await makeEnv(db, { wcId: wc.id, oid: 'env-a', name: 'EnvA', state: 'Draft', spec: oldSpec });
    await materializeEnvironmentRegistry(db, {
      workCenterId: wc.id, envSpecId: gone.id, envSpecName: 'EnvA',
      version: '1.0.0', state: 'Draft', downloadedAt: new Date('2026-08-01'), specJsonb: oldSpec,
    });
    await db.delete(environmentSpec).where(eq(environmentSpec.id, gone.id));

    const newSpec = { resource_property_specifications: [
      { name: 'Printer', resource_type: 'named pool', names: ['P1'] },
    ] };
    const fresh = await makeEnv(db, { wcId: wc.id, oid: 'env-b', name: 'EnvB', state: 'Effective', spec: newSpec });
    const { warnings } = await materializeEnvironmentRegistry(db, {
      workCenterId: wc.id, envSpecId: fresh.id, envSpecName: 'EnvB',
      version: '1.0.0', state: 'Effective', downloadedAt: new Date('2026-08-02'), specJsonb: newSpec,
    });

    expect(warnings).toHaveLength(1);
    // EnvA's environment_spec row is gone, so the incumbent's name can only come from the
    // denormalized wc_resource.defined_from_name column written at the first load — proving
    // the orphaned-name fallback (spec §4.6 ruling 2026-08-31) actually works.
    expect(warnings[0]).toContain('EnvA');
    expect(warnings[0]).toContain('EnvB');
    const [row] = await db.select().from(wcResource);
    expect(row.resourceType).toBe('named pool');
    expect(row.definedByEnvSpecId).toBe(fresh.id);
  } finally { await close(); }
});

test('an unknown resource_type is skipped with a warning and does not throw', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const spec = { resource_property_specifications: [
      { name: 'Widget', resource_type: 'quantum entangled use' },
    ] };
    const env = await makeEnv(db, { wcId: wc.id, spec });
    const { warnings } = await materializeEnvironmentRegistry(db, {
      workCenterId: wc.id, envSpecId: env.id, envSpecName: 'DemoLine',
      version: '1.0.0', state: 'Draft', downloadedAt: new Date('2026-08-01'), specJsonb: spec,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Widget');
    expect(await db.select().from(wcResource)).toHaveLength(0);
  } finally { await close(); }
});

test('a non-numeric use_limit is skipped with a warning and does not throw', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const spec = { resource_property_specifications: [
      { name: 'Slots', resource_type: 'countable use with pool limits', use_limit: 'five' },
    ] };
    const env = await makeEnv(db, { wcId: wc.id, spec });
    const { warnings } = await materializeEnvironmentRegistry(db, {
      workCenterId: wc.id, envSpecId: env.id, envSpecName: 'DemoLine',
      version: '1.0.0', state: 'Draft', downloadedAt: new Date('2026-08-01'), specJsonb: spec,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Slots');
    expect(await db.select().from(wcResource)).toHaveLength(0);
  } finally { await close(); }
});

test('a non-array names field is skipped with a warning and does not throw', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const spec = { resource_property_specifications: [
      { name: 'Bay', resource_type: 'named pool', names: 'B1' },
    ] };
    const env = await makeEnv(db, { wcId: wc.id, spec });
    const { warnings } = await materializeEnvironmentRegistry(db, {
      workCenterId: wc.id, envSpecId: env.id, envSpecName: 'DemoLine',
      version: '1.0.0', state: 'Draft', downloadedAt: new Date('2026-08-01'), specJsonb: spec,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Bay');
    expect(await db.select().from(wcResource)).toHaveLength(0);
  } finally { await close(); }
});

test('a malformed declaration does not poison a valid sibling in the same load', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const spec = { resource_property_specifications: [
      { name: 'Bad', resource_type: 'not a real type' },
      { name: 'Printer', resource_type: 'binary exclusive use' },
    ] };
    const env = await makeEnv(db, { wcId: wc.id, spec });
    const { warnings } = await materializeEnvironmentRegistry(db, {
      workCenterId: wc.id, envSpecId: env.id, envSpecName: 'DemoLine',
      version: '1.0.0', state: 'Draft', downloadedAt: new Date('2026-08-01'), specJsonb: spec,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Bad');
    const rows = await db.select().from(wcResource);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Printer');
  } finally { await close(); }
});

// --- I1: an out-of-range/non-integer use_limit must warn, not abort the whole load ------

test('an out-of-range use_limit is skipped with a warning, does not throw, and a valid sibling still materializes', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const spec = { resource_property_specifications: [
      { name: 'Huge', resource_type: 'countable use with pool limits', use_limit: 99999999999 },
      { name: 'Printer', resource_type: 'binary exclusive use' },
    ] };
    const env = await makeEnv(db, { wcId: wc.id, spec });
    const { warnings } = await materializeEnvironmentRegistry(db, {
      workCenterId: wc.id, envSpecId: env.id, envSpecName: 'DemoLine',
      version: '1.0.0', state: 'Draft', downloadedAt: new Date('2026-08-01'), specJsonb: spec,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Huge');
    const rows = await db.select().from(wcResource);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Printer');
  } finally { await close(); }
});

test('a non-integer use_limit is skipped with a warning and does not throw', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const spec = { resource_property_specifications: [
      { name: 'Slots', resource_type: 'countable use with pool limits', use_limit: 2.5 },
    ] };
    const env = await makeEnv(db, { wcId: wc.id, spec });
    const { warnings } = await materializeEnvironmentRegistry(db, {
      workCenterId: wc.id, envSpecId: env.id, envSpecName: 'DemoLine',
      version: '1.0.0', state: 'Draft', downloadedAt: new Date('2026-08-01'), specJsonb: spec,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Slots');
    expect(await db.select().from(wcResource)).toHaveLength(0);
  } finally { await close(); }
});

// --- m6: an over-long resource name must never reach the insert (btree index-row limit) ---

test('an over-long resource name is skipped with a warning and does not throw', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const longName = 'X'.repeat(MAX_NAME_LENGTH + 1);
    const spec = { resource_property_specifications: [
      { name: longName, resource_type: 'binary exclusive use' },
    ] };
    const env = await makeEnv(db, { wcId: wc.id, spec });
    const { warnings } = await materializeEnvironmentRegistry(db, {
      workCenterId: wc.id, envSpecId: env.id, envSpecName: 'DemoLine',
      version: '1.0.0', state: 'Draft', downloadedAt: new Date('2026-08-01'), specJsonb: spec,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('exceeds');
    expect(await db.select().from(wcResource)).toHaveLength(0);
  } finally { await close(); }
});

// --- m1: a malformed name/resource_type must warn end-to-end through materialize, too -----

test('a resource declaration with a non-string name or resource_type warns instead of silently vanishing', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const spec = { resource_property_specifications: [
      { name: 123, resource_type: 'binary exclusive use' },
      { name: 'NoType' },
      { name: 'Printer', resource_type: 'binary exclusive use' },
    ] };
    const env = await makeEnv(db, { wcId: wc.id, spec });
    const { warnings } = await materializeEnvironmentRegistry(db, {
      workCenterId: wc.id, envSpecId: env.id, envSpecName: 'DemoLine',
      version: '1.0.0', state: 'Draft', downloadedAt: new Date('2026-08-01'), specJsonb: spec,
    });
    expect(warnings).toHaveLength(2);
    const rows = await db.select().from(wcResource);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Printer');
  } finally { await close(); }
});

// --- I2: an identical re-load must repair orphaned provenance, silently -------------------

test('an orphaned incumbent is silently repaired by an identical re-load', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const spec = printerSpec();
    const first = await makeEnv(db, { wcId: wc.id, oid: 'env-1', name: 'DemoLine', state: 'Effective', spec });
    await materializeEnvironmentRegistry(db, {
      workCenterId: wc.id, envSpecId: first.id, envSpecName: 'DemoLine',
      version: '1.0.0', state: 'Effective', downloadedAt: new Date('2026-08-01'), specJsonb: spec,
    });

    // Delete the declaring spec. The FK is ON DELETE SET NULL, so the registry row survives
    // but is now orphaned.
    await db.delete(environmentSpec).where(eq(environmentSpec.id, first.id));
    const [orphaned] = await db.select().from(wcResource);
    expect(orphaned.definedByEnvSpecId).toBeNull();

    // Re-loading the IDENTICAL package creates a new environment_spec row (same oid,
    // version, state as before) and re-materializes the same, unchanged definition.
    const second = await makeEnv(db, { wcId: wc.id, oid: 'env-1', name: 'DemoLine', state: 'Effective', spec });
    const { warnings } = await materializeEnvironmentRegistry(db, {
      workCenterId: wc.id, envSpecId: second.id, envSpecName: 'DemoLine',
      version: '1.0.0', state: 'Effective', downloadedAt: new Date('2026-08-02'), specJsonb: spec,
    });

    // The definitions agree, so this is a silent repair — not a conflict.
    expect(warnings).toEqual([]);
    const [repaired] = await db.select().from(wcResource);
    expect(repaired.definedByEnvSpecId).toBe(second.id);
    expect(repaired.definedFromName).toBe('DemoLine');
  } finally { await close(); }
});

test('a non-orphaned incumbent that ties with the incoming spec keeps its own provenance (no fight over the row)', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const spec = printerSpec();
    // originOfIncumbent re-reads the incumbent's ACTUAL environment_spec.downloaded_at column
    // rather than trusting the caller's `downloadedAt` input, so a genuine tie needs both
    // rows to carry the identical stored downloadedAt — set explicitly rather than relying on
    // two inserts landing on the same wall-clock instant.
    const tieAt = new Date('2026-08-01T00:00:00Z');
    const [first] = await db.insert(environmentSpec).values({
      oid: 'env-1', name: 'DemoLine', workCenterId: wc.id,
      version: '1.0.0', state: 'Draft', specJsonb: spec as any, downloadedAt: tieAt,
    }).returning();
    await materializeEnvironmentRegistry(db, {
      workCenterId: wc.id, envSpecId: first.id, envSpecName: 'DemoLine',
      version: '1.0.0', state: 'Draft', downloadedAt: tieAt, specJsonb: spec,
    });

    // A second, equally-ranked spec (same state, version and downloadedAt) declares the
    // identical definition.
    const [second] = await db.insert(environmentSpec).values({
      oid: 'env-2', name: 'OtherLine', workCenterId: wc.id,
      version: '1.0.0', state: 'Draft', specJsonb: spec as any, downloadedAt: tieAt,
    }).returning();
    const { warnings } = await materializeEnvironmentRegistry(db, {
      workCenterId: wc.id, envSpecId: second.id, envSpecName: 'OtherLine',
      version: '1.0.0', state: 'Draft', downloadedAt: tieAt, specJsonb: spec,
    });

    expect(warnings).toEqual([]);
    const [row] = await db.select().from(wcResource);
    expect(row.definedByEnvSpecId).toBe(first.id); // unchanged — no fight over the row
  } finally { await close(); }
});

test('a same-identity re-load with an edited declaration says so instead of naming the spec twice', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const env = await makeEnv(db, { wcId: wc.id, oid: 'env-a', name: 'EnvA', state: 'Draft', spec: printerSpec() });
    const input = { workCenterId: wc.id, envSpecId: env.id, envSpecName: 'EnvA', version: '1.0.0', state: 'Draft', downloadedAt: new Date('2026-08-01') };
    await materializeEnvironmentRegistry(db, { ...input, specJsonb: printerSpec() });
    const edited = printerSpec({ resource_type: 'countable use with pool limits', use_limit: 2 });
    const { warnings } = await materializeEnvironmentRegistry(db, { ...input, specJsonb: edited });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Printer');
    expect(warnings[0]).toContain('this same spec');
    expect(warnings[0]).toContain('bump the version');
    expect(warnings[0].match(/"EnvA"/g)).toHaveLength(1); // named once, not "EnvA ... than by EnvA"
    const [row] = await db.select().from(wcResource);
    expect(row.resourceType).toBe('binary exclusive use'); // the existing definition stands
  } finally { await close(); }
});
