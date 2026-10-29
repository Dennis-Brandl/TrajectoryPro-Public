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

// Despite the filename (kept so the brief's file list — e2e/helpers/{auth,db}.ts —
// stays satisfied literally), this module holds no database client. DB access is
// confined to the node-only e2e/reset-db.mjs process, which runs as a shell step
// ahead of the server in playwright.config.ts's webServer command; every browser-driven
// spec talks HTTP only. What both the specs and playwright.config.ts actually need is a
// small set of typed constants: the two server origins, the e2e-dedicated Postgres URL,
// and the three demo logins seedDemo() creates — gathered here so nothing is duplicated
// or hand-typed differently across files.

/** The API server's own origin (src/server/index.ts, PORT env var). The e2e specs hit
 *  this directly for the one-time bootstrap POST — see helpers/auth.ts — bypassing the
 *  Vite proxy entirely for that call. */
export const API_BASE_URL = 'http://localhost:3002';

/** The Vite dev server's origin (vite.config.ts's fixed :5273 dev port is avoided here
 *  to not collide with a developer's own `npm run dev`); matches playwright.config.ts's
 *  `use.baseURL` — `page.goto('/login')` etc. resolve against this. */
export const APP_BASE_URL = 'http://localhost:5274';

/**
 * Dedicated e2e Postgres connection string. e2e/reset-db.mjs REFUSES to run against a
 * database whose name doesn't contain "e2e" (it drops and recreates the public schema),
 * so don't point this at a shared dev/prod database.
 *
 * The database itself must already exist (e.g. `createdb mission_commander_e2e`) —
 * reset-db.mjs only resets its schema, it does not create the database.
 *
 * Override by exporting DATABASE_URL before running `npm run e2e` (see
 * .env.e2e.example — this repo has no dotenv wiring anywhere, so that file is
 * documentation only, same as the root .env.example). reset-db.mjs is plain JS and
 * cannot import this module, so it repeats this exact literal as its own fallback —
 * keep the two in sync if you change it.
 */
export const E2E_DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/mission_commander_e2e';

export type DemoLogin = { email: string; password: string; loginName?: string };

// Mirrors src/server/seed.ts's DEMO list and PASSWORD exactly. seedDemo() is
// idempotent and runs (via `npm run seed`) as part of the API webServer command,
// before the server starts accepting requests — so all three logins below always
// exist by the time any spec runs.
const DEMO_PASSWORD = 'demo-pass-123';
// loginName mirrors seed.ts's DEMO list `login` field exactly (spec 2026-09-06 D6: seedDemo
// sets these explicitly rather than letting the 0031 trigger derive one from the email local
// part) — the e-signature spec (cockpit-esignature.spec.ts) signs in with these.
export const ADMIN: DemoLogin = { email: 'admin@command.local', password: DEMO_PASSWORD, loginName: 'admin' };
export const STEWARD: DemoLogin = { email: 'steward@command.local', password: DEMO_PASSWORD, loginName: 'steward' };
export const VIEWER: DemoLogin = { email: 'viewer@command.local', password: DEMO_PASSWORD };

// A login MINTED BY THE E2E ITSELF (not seeded) — the golden-path leg creates it via the
// admin UI, so its starting password differs from the demo logins. Keep the email stable
// so the password-reset and impersonation legs can target the same account.
export const NEW_USER = { email: 'e2e-created@command.local', password: 'e2e-initial-pw-1', newPassword: 'e2e-rotated-pw-2', displayName: 'E2E Created User', loginName: 'e2e-created' };

/** Mission Broker bearer token for the e2e broker web server (fake; never use outside e2e). */
export const E2E_BROKER_TOKEN = 'e2e-broker-token-not-for-production-0123456789';
