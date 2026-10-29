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
import { existingLibraryWrites } from '../existingLibraryWrites'
import type { ImportPlanRow } from '@/types/wflibx-import'

const row = (kind: 'library' | 'specification', bundleOid: string, status: ImportPlanRow['status']): ImportPlanRow => ({
  kind,
  entityType: 'step',
  bundleOid,
  bundleName: bundleOid,
  bundleVersion: '1.0.0',
  status,
})
const existing = { libraries: [], specifications: [{ id: 'S-old', libraryId: 'L-old', name: 'x' }] }

describe('existingLibraryWrites — which existing libraries a .WFlibX commit would write', () => {
  it('a replaced library conflict deletes that library', () => {
    const rows = [
      row('library', 'B1', { tag: 'conflict', existingOid: 'L-old', existingName: 'x', existingVersion: '' }),
    ]
    expect(existingLibraryWrites(rows, { B1: 'replace' }, existing)).toEqual([
      { libraryId: 'L-old', verb: 'library.delete', entityType: 'step' },
    ])
  })

  it('a kept library conflict writes nothing by itself', () => {
    const rows = [
      row('library', 'B1', { tag: 'conflict', existingOid: 'L-old', existingName: 'x', existingVersion: '' }),
    ]
    expect(existingLibraryWrites(rows, { B1: 'keep' }, existing)).toEqual([])
  })

  it('adding a spec to an existing library creates in it', () => {
    const rows = [row('specification', 'S1', { tag: 'add-to-existing', existingLibraryOid: 'L-old' })]
    expect(existingLibraryWrites(rows, {}, existing)).toEqual([
      { libraryId: 'L-old', verb: 'create', entityType: 'step' },
    ])
  })

  it('replacing an existing spec edits its library; keeping it writes nothing', () => {
    const conflict = row('specification', 'S1', {
      tag: 'conflict',
      existingOid: 'S-old',
      existingName: 'x',
      existingVersion: '',
    })
    expect(existingLibraryWrites([conflict], { S1: 'replace' }, existing)).toEqual([
      { libraryId: 'L-old', verb: 'edit', entityType: 'step' },
    ])
    expect(existingLibraryWrites([conflict], { S1: 'keep' }, existing)).toEqual([])
  })

  it('creates and no-ops touch no existing library', () => {
    const rows = [
      row('library', 'B1', { tag: 'create' }),
      row('specification', 'S1', { tag: 'no-op', existingOid: 'S-old' }),
    ]
    expect(existingLibraryWrites(rows, {}, existing)).toEqual([])
  })
})
