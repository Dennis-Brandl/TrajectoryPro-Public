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

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from '../../src/db/schema/index.js';

type Journal = { entries: Array<{ idx: number; tag: string }> } & Record<string, unknown>;

/**
 * A PGlite migrated only up to and including journal entry `idx`, so a test can seed
 * PRE-migration rows and then apply a data-carrying migration by hand. The migrator
 * reads a journal + SQL files, so a temp folder holding a truncated copy is enough.
 */
export async function makeTestDbUpTo(idx: number): Promise<{
  db: PgliteDatabase<typeof schema>; close: () => Promise<void>;
}> {
  const journal = JSON.parse(readFileSync('./drizzle/meta/_journal.json', 'utf8')) as Journal;
  const dir = mkdtempSync(join(tmpdir(), 'mcdb-partial-'));
  mkdirSync(join(dir, 'meta'));
  const entries = journal.entries.filter((e) => e.idx <= idx);
  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }));
  for (const e of entries) copyFileSync(`./drizzle/${e.tag}.sql`, join(dir, `${e.tag}.sql`));
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: dir });
  return { db, close: () => client.close() };
}

/** Applies one migration file's statements in order (split on drizzle's breakpoint marker). */
export async function applyMigrationFile(db: PgliteDatabase<typeof schema>, tag: string): Promise<void> {
  const text = readFileSync(`./drizzle/${tag}.sql`, 'utf8');
  for (const stmt of text.split('--> statement-breakpoint')) {
    const s = stmt.trim();
    if (s) await db.execute(sql.raw(s));
  }
}
