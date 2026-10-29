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
    name: 'server',
    environment: 'node',
    // Vitest 4 dropped '**/dist/**' from its default excludes. This
    // package's tsconfig DOES exclude src/__tests__ from `tsc --build`, so
    // today's dist/ carries no compiled test pairs — but that's a property
    // of the current tsconfig, not something this vitest config should rely
    // on. Same hazard class as storage/engine (see their vitest.config.ts):
    // pin collection to src explicitly so a future tsconfig change can't
    // silently reintroduce doubled test collection here too.
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Most suites spin up their own PGlite (embedded Postgres, WASM) instance
    // per test via createTestDb(), several also spawn a real Python worker
    // pool (InstanceManager). Running the full monorepo suite together means
    // dozens of concurrent PGlite instances + subprocess pools competing for
    // CPU, which blows past vitest's 5000ms/10000ms defaults even though
    // every individual operation succeeds — see packages/storage/vitest.config.ts
    // and packages/engine/vitest.config.ts for the same rationale. Bumped,
    // not disabled — real hangs still fail loudly.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
