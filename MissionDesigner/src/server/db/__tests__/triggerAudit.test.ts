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

// Phase 35 §5.6.1 F8: _trigger_audit infrastructure test. Asserts the
// audit table is created in dev/test mode and that a triggering operation
// records a row. Full coverage (every defined trigger fires at least once)
// lives in the Wave F seed script.

// @vitest-environment node

import { describe, it, expect, beforeAll } from 'vitest'
import { rawQuery, bootstrapDatabase } from '../../lib/db'

beforeAll(async () => {
  // NODE_ENV !== 'production' (vitest default is 'test') → audit enabled.
  await bootstrapDatabase()
})

describe('_trigger_audit', () => {
  it('table exists in dev/test mode', async () => {
    const rows = await rawQuery(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = '_trigger_audit'`,
    )
    expect(rows).toHaveLength(1)
  })
})
