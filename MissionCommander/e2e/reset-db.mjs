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
//
// Resets the dedicated e2e Postgres database to a clean, fully-migrated schema. Runs
// as the first step of playwright.config.ts's API webServer command, ahead of
// `npm run seed` and `npm run start`. Plain node ESM — no TypeScript, no imports from
// the (TS) e2e/helpers/* modules — so it's excluded from tsconfig.e2e.json by design;
// keep it small and obvious.
//
// GUARD RAIL: this script DROPs the public schema. It refuses to run against any
// database whose name doesn't contain "e2e", so a misconfigured DATABASE_URL (e.g. one
// accidentally pointing at the shared dev/prod database) fails loudly instead of
// destroying real data.
//
// The database itself must already exist (e.g. `createdb mission_commander_e2e`) — this
// script only resets its schema, it does not create the database.
import { Client } from 'pg';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Duplicated (not imported) from e2e/helpers/db.ts's E2E_DATABASE_URL — this file is
// plain JS by design (see header comment) and can't cleanly import that TS module.
// Keep the two literals in sync if you change either.
const DEFAULT_URL = 'postgres://postgres:postgres@localhost:5432/mission_commander_e2e';
const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_URL;

const dbName = new URL(databaseUrl).pathname.replace(/^\//, '');
if (!dbName.includes('e2e')) {
  console.error(
    `reset-db: refusing to run — database name "${dbName}" does not contain "e2e". ` +
      'This script drops the public schema; point DATABASE_URL at a dedicated e2e database.',
  );
  process.exit(1);
}

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  console.log(`reset-db: resetting schema on "${dbName}"…`);
  // Also drop the drizzle-kit migrations journal schema — it survives a plain
  // public-schema drop, which would make drizzle-kit believe every migration already
  // ran and silently skip re-applying them against the now-empty public schema.
  await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
} finally {
  await client.end();
}

// mission-control-db owns the canonical migrations (drizzle/*.sql via drizzle-kit,
// configured in its drizzle.config.ts). Running its own `db:migrate` script is the
// sanctioned entry point — this deliberately does not re-implement SQL application or
// reach into drizzle-kit's internals directly.
const here = path.dirname(fileURLToPath(import.meta.url));
const mcDbRoot = path.resolve(here, '../node_modules/mission-control-db');
console.log('reset-db: applying mission-control-db migrations…');
// `shell: true` is REQUIRED on Windows: Node ≥18.20.2 (CVE-2024-27980 hardening)
// throws EINVAL when spawning a .bat/.cmd (npm.cmd) without it, because .cmd
// execution always routes through cmd.exe. A single command STRING (not an args
// array) avoids Node 24's DEP0190 unescaped-args deprecation; the command is a
// fixed literal, so there is no injection surface. The shell also resolves
// npm/npm.cmd per-platform, replacing the old win32 ternary.
const result = spawnSync('npm run db:migrate', {
  cwd: mcDbRoot,
  env: { ...process.env, DATABASE_URL: databaseUrl },
  stdio: 'inherit',
  shell: true,
});
if (result.error) {
  console.error('reset-db: failed to spawn `npm run db:migrate`:', result.error);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(`reset-db: mission-control-db migrations failed (exit ${result.status}).`);
  process.exit(result.status ?? 1);
}
console.log('reset-db: done.');
