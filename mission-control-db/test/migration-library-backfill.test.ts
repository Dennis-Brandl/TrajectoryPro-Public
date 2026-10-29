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
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Applies one drizzle .sql file, honouring its statement-breakpoint separators.
async function applySql(client: PGlite, file: string): Promise<void> {
  const sql = readFileSync(`./drizzle/${file}`, 'utf8');
  for (const stmt of sql.split('--> statement-breakpoint')) {
    const trimmed = stmt.trim();
    if (trimmed) await client.exec(trimmed);
  }
}

test('0013 backfill: creates Default + one library per distinct name, and repoints every row', async () => {
  const client = new PGlite();
  const files = readdirSync('./drizzle').filter((f) => f.endsWith('.sql')).sort();
  const pre = files.filter((f) => f < '0013');
  const [migration] = files.filter((f) => f.startsWith('0013'));
  expect(migration).toBeDefined();

  for (const f of pre) await applySql(client, f);

  // Pre-migration rows: one named library, one NULL library, one name shared across tables.
  await client.exec(`
    INSERT INTO "workflow" ("oid","name","library_name","spec_jsonb") VALUES
      ('w-1','Bake','Recipes','{}'),
      ('w-2','Orphan',NULL,'{}');
    INSERT INTO "environment_spec" ("oid","name","library_name","spec_jsonb") VALUES
      ('e-1','Kitchen','KitchenLib','{}'),
      ('e-2','Shared','Recipes','{}');
  `);

  await applySql(client, migration);

  const libs = await client.query<{ name: string }>(`SELECT "name" FROM "library" ORDER BY "name"`);
  expect(libs.rows.map((r) => r.name)).toEqual(['Default', 'KitchenLib', 'Recipes']);

  const rows = await client.query<{ name: string; lib: string }>(`
    SELECT w."name" AS name, l."name" AS lib FROM "workflow" w JOIN "library" l ON l."id" = w."library_id"
    UNION ALL
    SELECT e."name" AS name, l."name" AS lib FROM "environment_spec" e JOIN "library" l ON l."id" = e."library_id"
    ORDER BY name
  `);
  expect(rows.rows).toEqual([
    { name: 'Bake', lib: 'Recipes' },
    { name: 'Kitchen', lib: 'KitchenLib' },
    { name: 'Orphan', lib: 'Default' },   // NULL library_name lands in Default
    { name: 'Shared', lib: 'Recipes' },   // shared name reuses the SAME library row
  ]);
  await client.close();
});
