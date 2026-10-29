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

import { defineConfig, devices } from '@playwright/test'

// E2E runs against a dedicated, disposable Postgres database — never the
// dev/container instance. webServer.env sets this for the server child; we set
// it here too so the spec/runner process sees the SAME database the server
// writes to. Keep both URLs identical.
process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5433/mission_designer_e2e'

/**
 * Playwright E2E test configuration for Mission Designer.
 *
 * Runs against the full stack: Hono API server (port 3001) + Vite dev server (port 5174).
 * Only Chromium is tested — the app targets a controlled deployment environment.
 *
 * To run:
 *   npx playwright test
 *   npx playwright test --ui          (interactive UI mode)
 *   npx playwright test e2e/auth.spec.ts  (single file)
 */
export default defineConfig({
  testDir: './e2e',

  /* Bootstrap the fresh e2e DB through the /setup flow before any test runs. */
  globalSetup: './e2e/global-setup.ts',

  /* Run tests in each file in sequence (not parallel) to avoid IndexedDB / auth conflicts */
  fullyParallel: false,
  workers: 1,

  /* Fail the build on CI if any test.only is left in source */
  forbidOnly: !!process.env.CI,

  /* No retries by default — tests should be deterministic */
  retries: process.env.CI ? 1 : 0,

  /* Reporter: list in the terminal, HTML report always generated */
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    /* Base URL so page.goto('/login') works */
    baseURL: 'http://localhost:5174',

    /* Capture trace on first retry for debugging */
    trace: 'on-first-retry',

    /* Screenshots on failure */
    screenshot: 'only-on-failure',

    /* Default timeouts */
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Global test timeout */
  timeout: 30_000,
  expect: {
    /* Assertion timeout — how long expect(...).toBeVisible() polls before failing */
    timeout: 8_000,
  },

  /**
   * Start the full stack before running tests. The command first resets the
   * dedicated E2E Postgres database (e2e-reset-db.mjs: DROP/CREATE public
   * schema) so every run starts from a fresh, un-bootstrapped DB (→ the /setup
   * flow that globalSetup drives), then runs `npm run dev:all` (build tokens +
   * help → scripts/dev-start.mjs → API 3001 + Vite 5174).
   * reuseExistingServer:false guarantees a clean DB each run.
   * NODE_ENV must remain 'development' — 'test' would make the DB factory pick
   * PGlite instead of the real pg Pool, defeating the e2e fidelity gate.
   * env is forwarded to the API child (dev-start.mjs spreads process.env).
   */
  webServer: {
    command: 'node scripts/e2e-reset-db.mjs && npm run dev:all',
    url: 'http://localhost:5174',
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5433/mission_designer_e2e',
      PORT: '3001',
      VITE_PORT: '5174',
      NODE_ENV: 'development',
    },
  },
})
