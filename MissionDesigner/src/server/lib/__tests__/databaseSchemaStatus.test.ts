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

// @vitest-environment node

import { describe, it, expect, beforeAll } from 'vitest'
import { rawQuery, bootstrapDatabase, databaseSchemaStatus } from '../db'

// Verifies the permanent rule: a distributed app must guarantee its database
// has every required table on startup. databaseSchemaStatus() is what both the
// boot-time fail-fast check and /api/health rely on.
describe('databaseSchemaStatus', () => {
  beforeAll(async () => {
    await bootstrapDatabase()
  })

  it('reports ok with no missing tables after startup initialization', async () => {
    const status = await databaseSchemaStatus()
    expect(status.ok).toBe(true)
    expect(status.missingTables).toEqual([])
  })

  it('detects a missing table when one is dropped', async () => {
    // image_reference is a leaf table — nothing else FK-depends on it — so we
    // can drop it to simulate an incomplete schema without cascading.
    await rawQuery('DROP TABLE IF EXISTS "image_reference"')
    const status = await databaseSchemaStatus()
    expect(status.ok).toBe(false)
    expect(status.missingTables).toContain('image_reference')
  })
})
