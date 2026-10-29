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
import { defineConfig, devices } from '@playwright/test';
import { API_BASE_URL, APP_BASE_URL, E2E_BROKER_TOKEN, E2E_DATABASE_URL } from './e2e/helpers/db';

// Golden-path e2e for the Mission Commander renderer. Drives the REAL Hono server
// against a REAL, disposable, e2e-only Postgres — never PGlite/a mock — per the
// Task-14 brief's environment note.
//
// Three webServer entries rather than `&`-chained commands: this is portable to
// Windows (no `cross-env`, no bare `&`, which on cmd.exe runs sequentially instead of
// concurrently and would hang forever behind `tsx watch`/`npm run start`'s long-lived
// process). Entry 1 resets the e2e DB, seeds it, and starts the API on :3002; entry 2
// starts Vite on :5274, whose /api proxy targets :3002 (vite.config.ts); entry 3 (Task
// 20) boots the Mission Engine worker on :3006 against the SAME e2e database, so a
// runtime workflow a spec starts is actually executed rather than sitting queued
// forever. Playwright starts all three concurrently and waits for all three health
// checks before running tests — entry 3's boot races entry 1's reset+migrate chain
// (its own loop tolerates that: see loop.ts's runOnce outer catch), and its own
// `/health` endpoint comes up independently of the database, so the race never blocks
// Playwright's own readiness wait.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  // retries: 0 is load-bearing — the legs mutate shared reset-once seed state and are NOT
  // self-idempotent (e.g. Leg C's "0 workflows" precondition, Leg D's not.toBeChecked), so a
  // retry would re-run against already-mutated state and fail confusingly.
  retries: 0,
  use: {
    baseURL: APP_BASE_URL,
  },
  projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }],
  webServer: [
    {
      // reset-db.mjs drops/recreates the schema and re-applies mission-control-db's
      // migrations; `npm run seed` then (idempotently) creates all three demo logins
      // BEFORE the server starts accepting requests, so the public-signup gate is
      // already closed by the time any spec runs (see e2e/helpers/auth.ts's contract).
      command: 'node e2e/reset-db.mjs && npm run seed && npm run start',
      url: `${API_BASE_URL}/api/setup-status`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        PORT: '3002',
        DATABASE_URL: E2E_DATABASE_URL,
        BASE_URL: API_BASE_URL,
        // src/server/lib/auth.ts's trustedOrigins() hardcodes :5173/:3002 and reads
        // this var for the rest. The e2e Vite origin (APP_BASE_URL, :5274) must be
        // trusted or better-auth's origin-check middleware 403s EVERY state-changing
        // auth request whose caller sends an Origin header — which includes both
        // bootstrapFirstAdmin's POST (helpers/auth.ts) and, critically, every real
        // browser sign-in from the SPA itself (Chromium sends Origin/Sec-Fetch-Site on
        // same-origin POSTs; verified against the installed better-auth package's
        // origin-check middleware, not assumed).
        ALLOWED_ORIGINS: APP_BASE_URL,
        // Throwaway secret for the disposable e2e database only.
        BETTER_AUTH_SECRET: 'e2e-test-secret-not-for-production',
        // Phase 6: engine-client.ts calls the Mission Engine's token-gated /internal/* API for
        // every runtime-workflow control (pause/resume/stop/abort/force-release) — Start and
        // Delete deliberately stay on the DB seam (D9). Both this entry AND entry 3 below must
        // agree on the same throwaway token, or the engine's fail-closed gate (internal.ts)
        // 401s every control the UI sends.
        ENGINE_BASE_URL: 'http://localhost:3006',
        ENGINE_INTERNAL_TOKEN: 'e2e-internal-token',
      },
    },
    {
      command: 'npx vite --port 5274 --strictPort',
      url: APP_BASE_URL,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        // vite.config.ts's /api proxy target — must match the API entry's PORT above.
        API_PORT: '3002',
      },
    },
    {
      // Task 20: the Mission Engine worker, against the SAME e2e database as entry 1.
      // `npm run start` runs `tsx src/index.ts` directly (no docker/esbuild bundle needed
      // for e2e — that's the production image's own concern, MissionEngine/
      // Dockerfile). Health app starts serving immediately on boot, independent of the
      // database, so `url` below is ready well before the schema exists.
      //
      // Phase 4b (Task 11): the Pilot build now runs first — vite.config.ts's outDir
      // points straight at ../MissionEngine/public, so `npm run build` there IS
      // the deploy for this webServer entry (the engine's index.ts serves ./public as a
      // static SPA fallback). The longer `timeout` covers the added Vite build step ahead
      // of the engine's own boot. BETTER_AUTH_SECRET matches entry 1's so the engine's
      // better-auth instance and the API server's agree (cf. config.ts's DEV_AUTH_SECRET
      // fallback). ENGINE_BASE_URL is `localhost`, NOT `127.0.0.1`: index.ts's
      // canonical-host redirect steers any GET whose Host header disagrees with
      // cfg.baseUrl's host to that host — Playwright navigates to localhost:3006, and
      // localhost/127.0.0.1 are separate cookie jars (the M5 lesson), so a mismatch here
      // would bounce the operator's session cookie onto the wrong origin.
      command: 'npm --prefix ../MissionPilot run build && npm --prefix ../MissionEngine run start',
      url: 'http://localhost:3006/health',
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        DATABASE_URL: E2E_DATABASE_URL,
        ENGINE_PORT: '3006',
        BETTER_AUTH_SECRET: 'e2e-test-secret-not-for-production',
        ENGINE_BASE_URL: 'http://localhost:3006',
        // Must match entry 1's ENGINE_INTERNAL_TOKEN above — internal.ts's fail-closed gate
        // checks the caller's token against this same value.
        ENGINE_INTERNAL_TOKEN: 'e2e-internal-token',
        // Task 9: the engine sends this token to the Mission Broker origin only.
        MISSION_BROKER_URL: 'http://localhost:3007',
        MISSION_BROKER_TOKEN: E2E_BROKER_TOKEN,
      },
    },
    {
      // Distributed Workflow actions phase 2: the Mission Broker action server, against the
      // SAME e2e database. A short poll keeps its wait backstop quick in the e2e.
      command: 'npm --prefix ../MissionBroker run start',
      url: 'http://localhost:3007/health',
      reuseExistingServer: false,
      timeout: 120_000,
      env: { DATABASE_URL: E2E_DATABASE_URL, BROKER_PORT: '3007', BROKER_POLL_MS: '1000', MISSION_BROKER_TOKEN: E2E_BROKER_TOKEN },
    },
  ],
});
