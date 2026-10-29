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

// Dedicated config for `npm run test:pg`. The default root `vitest.config.ts`
// is a `projects` workspace, and the storage project's own `exclude` (which
// keeps `**/*.smoke.test.ts` out of the default `npx vitest run`, see
// vitest.config.ts) is ALSO applied when a project's file is targeted
// directly by path from the root config — `vitest run
// packages/storage/src/__tests__/real-pg.smoke.test.ts` reports "No test
// files found" rather than running it. This standalone config sidesteps the
// projects/exclude machinery entirely so the smoke file can be targeted on
// its own.
export default defineConfig({
  test: {
    include: ['packages/storage/src/__tests__/real-pg.smoke.test.ts'],
    environment: 'node',
    testTimeout: 60000,
    hookTimeout: 60000,
  },
})
