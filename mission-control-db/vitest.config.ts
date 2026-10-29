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
    // Vitest's 5000ms default is tuned for in-process unit tests. Every `makeTestDb()` here
    // provisions a fresh PGlite and replays the ENTIRE ./drizzle folder (17 migrations and
    // counting), and any test that builds a package does it twice — one database to export
    // from, one to import into. With `pool: 'forks'` running 38 files concurrently those
    // replays contend for CPU, and individual tests cross 5s while being perfectly correct.
    //
    // This is a per-test budget, not a correctness knob. It was raised when three tests in
    // package/import.test.ts — including pre-existing ones, not just the new arrivals —
    // began timing out purely because three more database-backed tests joined that file.
    // Migration count only grows, so the pressure is monotonic: expect to raise this again
    // rather than to trim tests.
    testTimeout: 30000,
  },
});
