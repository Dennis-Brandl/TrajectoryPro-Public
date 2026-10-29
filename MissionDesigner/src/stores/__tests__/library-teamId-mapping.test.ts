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

import { describe, it, expect } from 'vitest'
import { LibrarySchema } from '../specificationStore/zodSchemas'

describe('LibrarySchema teamId (Phase 5a)', () => {
  const base = {
    id: 'lib1',
    parentLibraryId: null,
    userId: 'u1',
    name: 'Lib',
    entityType: 'workflow',
    description: null,
    version: '1.0.0',
    forkedFromLibraryId: null,
    forkedFromVersion: null,
    forkedAt: null,
    createdAt: 1,
    updatedAt: 1,
    lastEditedByUserId: null,
  }

  it('parses and exposes teamId as a typed field', () => {
    const parsed = LibrarySchema.parse({ ...base, teamId: 'team-a' })
    expect(parsed.teamId).toBe('team-a')
  })

  it('accepts a null teamId', () => {
    const parsed = LibrarySchema.parse({ ...base, teamId: null })
    expect(parsed.teamId).toBeNull()
  })
})
