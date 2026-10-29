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

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    pool: 'forks',
    // See mission-control-db/vitest.config.ts for why this is raised above vitest's 5000ms
    // default: makeTestDb() provisions a fresh PGlite and replays the full ./drizzle
    // migration folder (mission-control-db's, currently 19 files) per test file.
    testTimeout: 30000,
  },
});
