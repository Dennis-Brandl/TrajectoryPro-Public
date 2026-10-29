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

/**
 * Pixel goldens for @mission/form-renderer. Chromium-only; baselines are
 * generated and committed on the local platform (Windows) — see README for the
 * Docker/CI switch path. The webServer boots the dedicated golden harness
 * (renderer only, deterministic media) on port 5175.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5175',
    trace: 'on-first-retry',
  },
  expect: {
    toHaveScreenshot: { maxDiffPixels: 100, animations: 'disabled' },
  },
  projects: [
    {
      name: 'chromium',
      // Viewport wider than the 1440 container so the frame isn't horizontally clipped.
      use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 2000 } },
    },
  ],
  timeout: 30_000,
  webServer: {
    command: 'npm run build:tokens && npm run golden',
    url: 'http://localhost:5175',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
