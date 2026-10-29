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

import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'engine',
    environment: 'node',
    // Vitest 4 dropped '**/dist/**' from its default excludes. This
    // package's tsconfig does NOT exclude src/__tests__ from `tsc --build`
    // (dist emission of tests is intentional/fine), so a build regenerates
    // dist/__tests__/*.test.js — without this exclude, vitest would collect
    // BOTH the src/*.test.ts and the compiled dist/*.test.js as separate
    // files, silently doubling every test after any full build.
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Several suites (state-machine, instance-manager*, integration) spin up
    // their own PGlite (embedded Postgres, WASM) instance per test via
    // createTestDb(), same as packages/storage. Running the full monorepo
    // suite together means dozens of concurrent PGlite instances competing
    // for CPU, which blows past vitest's 5000ms/10000ms defaults even though
    // every individual operation succeeds — see packages/storage/vitest.config.ts
    // for the same rationale. Bumped, not disabled — real hangs still fail loudly.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
