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
import { sql } from 'drizzle-orm';
import { makeTestDbUpTo, applyMigrationFile } from '../helpers/partial-migrate.js';

type Row = Record<string, unknown>;
async function rows(db: any, q: string): Promise<Row[]> {
  return (await db.execute(sql.raw(q))).rows as Row[];
}
// One statement per execute: drizzle's PGlite driver prepares each query, and a prepared
// statement cannot carry several commands.
async function exec(db: any, statements: string[]): Promise<void> {
  for (const s of statements) await db.execute(sql.raw(s));
}

test('0029 fans every global user_role out to each work center the user belongs to', async () => {
  const { db, close } = await makeTestDbUpTo(28);
  try {
    await exec(db, [
      `INSERT INTO app_user (id, email, display_name) VALUES
        ('00000000-0000-0000-0000-00000000000a', 'a@x.io', 'A'),
        ('00000000-0000-0000-0000-00000000000b', 'b@x.io', 'B'),
        ('00000000-0000-0000-0000-00000000000c', 'c@x.io', 'C')`,
      `INSERT INTO role (id, name) VALUES
        ('00000000-0000-0000-0000-000000000101', 'Operator'),
        ('00000000-0000-0000-0000-000000000102', 'Supervisor')`,
      `INSERT INTO work_center (id, name) VALUES
        ('00000000-0000-0000-0000-000000000201', 'WC1'),
        ('00000000-0000-0000-0000-000000000202', 'WC2')`,
      // A: member of both, Operator globally  → 2 rows
      // B: member of WC1, Operator+Supervisor  → 2 rows
      // C: member of nothing, Supervisor       → 0 rows (never matched anything)
      `INSERT INTO work_center_user (work_center_id, user_id) VALUES
        ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-00000000000a'),
        ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-00000000000a'),
        ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-00000000000b')`,
      `INSERT INTO user_role (user_id, role_id) VALUES
        ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000101'),
        ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000101'),
        ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000102'),
        ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000102')`,
    ]);

    await applyMigrationFile(db, '0029_work_center_user_role');

    const out = await rows(db, `
      SELECT work_center_id AS wc, user_id AS u, role_id AS r FROM work_center_user_role ORDER BY wc, u, r`);
    expect(out).toEqual([
      { wc: '00000000-0000-0000-0000-000000000201', u: '00000000-0000-0000-0000-00000000000a', r: '00000000-0000-0000-0000-000000000101' },
      { wc: '00000000-0000-0000-0000-000000000201', u: '00000000-0000-0000-0000-00000000000b', r: '00000000-0000-0000-0000-000000000101' },
      { wc: '00000000-0000-0000-0000-000000000201', u: '00000000-0000-0000-0000-00000000000b', r: '00000000-0000-0000-0000-000000000102' },
      { wc: '00000000-0000-0000-0000-000000000202', u: '00000000-0000-0000-0000-00000000000a', r: '00000000-0000-0000-0000-000000000101' },
    ]);
    // user_role still exists after 0029 (dropped by 0030).
    expect((await rows(db, 'SELECT count(*)::int AS n FROM user_role'))[0]!.n).toBe(4);

    await applyMigrationFile(db, '0030_drop_user_role');
    await expect(rows(db, 'SELECT count(*) FROM user_role')).rejects.toThrow(/user_role/);
    // The fan-out survives the drop.
    expect((await rows(db, 'SELECT count(*)::int AS n FROM work_center_user_role'))[0]!.n).toBe(4);
  } finally { await close(); }
});

test('0031 backfills login_name from the email local part with collision suffixes, then constrains', async () => {
  const { db, close } = await makeTestDbUpTo(30);
  try {
    await exec(db, [
      `INSERT INTO app_user (id, email, display_name, created_at) VALUES
        ('00000000-0000-0000-0000-000000000001', 'Bob.Smith@X.io', 'first',  '2026-01-01'),
        ('00000000-0000-0000-0000-000000000002', 'bob.smith@y.io', 'second', '2026-01-02'),
        ('00000000-0000-0000-0000-000000000003', '.weird+name@z.io', 'w',    '2026-01-03'),
        ('00000000-0000-0000-0000-000000000004', 'a@x.io', 'short',          '2026-01-04')`,
    ]);
    await applyMigrationFile(db, '0031_app_user_login_name');
    const out = await rows(db, `SELECT id, login_name FROM app_user ORDER BY created_at`);
    expect(out.map((r) => r.login_name)).toEqual(['bob.smith', 'bob.smith-2', 'weird-name', 'user']);
    // Constraints are live afterwards.
    await expect(rows(db, `INSERT INTO app_user (email, display_name, login_name) VALUES ('n@x.io','n','Bad Name')`)).rejects.toThrow();
    // And the trigger derives for a post-migration insert that omits the column.
    await rows(db, `INSERT INTO app_user (email, display_name) VALUES ('bob.smith@z.io','third')`);
    expect((await rows(db, `SELECT login_name FROM app_user WHERE email = 'bob.smith@z.io'`))[0]!.login_name).toBe('bob.smith-3');
  } finally { await close(); }
});

test('0031 backfill re-checks a later row\'s already-suffixed base so it never collides with an earlier row\'s suffix', async () => {
  // bob@a.io and bob@b.io both derive 'bob'; bob-2@c.io derives 'bob-2' directly. A backfill
  // pass that blindly appends '-<row_number>' per collision GROUP (rather than re-checking
  // uniqueness against the whole table as it goes, like the trigger does) rewrites the second
  // 'bob' row to 'bob-2' without noticing 'bob-2' is already taken by the third row, and the
  // UNIQUE constraint added later in this same migration then aborts the whole thing.
  const { db, close } = await makeTestDbUpTo(30);
  try {
    await exec(db, [
      `INSERT INTO app_user (id, email, display_name, created_at) VALUES
        ('00000000-0000-0000-0000-000000000011', 'bob@a.io', 'first',  '2026-01-01'),
        ('00000000-0000-0000-0000-000000000012', 'bob@b.io', 'second', '2026-01-02'),
        ('00000000-0000-0000-0000-000000000013', 'bob-2@c.io', 'third', '2026-01-03')`,
    ]);
    await applyMigrationFile(db, '0031_app_user_login_name');
    const out = await rows(db, `SELECT login_name FROM app_user ORDER BY created_at`);
    expect(out.map((r) => r.login_name)).toEqual(['bob', 'bob-2', 'bob-2-2']);
  } finally { await close(); }
});
