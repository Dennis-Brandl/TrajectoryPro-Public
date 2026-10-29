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

import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react-swc'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['**/node_modules/**', '**/perf.test.ts'],
    // Server integration tests each import the full app + initialize a SQLite DB
    // under the jsdom environment and SWC transform — heavy, memory-hungry setup.
    // With vitest's default of one worker per core (16 on this box) the machine
    // oversubscribes: the normally ~1s `setupTestFixture` beforeAll hook balloons
    // past the timeout and flakes whichever files are unlucky. Cap the worker pool
    // to bound concurrent heavy setups, and give the long-running setup hook ample
    // headroom (the dev box also runs the Runtime + Action containers at once).
    maxWorkers: 4,
    hookTimeout: 60000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**'],
      exclude: ['src/routes/**', 'src/**/*.d.ts', 'src/routeTree.gen.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    // MUST mirror vite.config.ts — this is a separate config, so that one's dedupe does not
    // reach tests. The @mission/form-* packages are `file:` deps on the sibling
    // MissionFormKit checkout; vite resolves through the symlink to the real path, and
    // module resolution from there finds MissionFormKit/node_modules/react (19.2.7) while
    // react-dom stays ours (19.2.4). Two Reacts => "Invalid hook call" on the renderer's
    // first useState. Verified: removing this fails formkit-integration.test.tsx immediately.
    dedupe: ['react', 'react-dom'],
  },
})
