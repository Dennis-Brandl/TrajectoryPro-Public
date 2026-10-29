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

import { describe, it, expect } from 'vitest'
import { BatchSaveRequest } from '../requestSchema'

const EMPTY = { specs: [], proxyRefs: [], specEnvs: [], imageDeletes: [], imageRefs: [] }

describe('BatchSaveRequest zod schema (§2.4)', () => {
  it('accepts an empty shell', () => {
    expect(BatchSaveRequest.safeParse(EMPTY).success).toBe(true)
  })

  it('rejects unknown top-level fields (strict mode)', () => {
    expect(BatchSaveRequest.safeParse({ ...EMPTY, surprise: 1 }).success).toBe(false)
  })

  it('accepts a spec create', () => {
    const r = BatchSaveRequest.safeParse({
      ...EMPTY,
      specs: [
        {
          op: 'create',
          id: 'new-1',
          parentSpecificationId: null,
          rootSpecificationId: 'new-1',
          libraryId: 'lib1',
          name: 'Root',
          data: '{"nodes":[]}',
          dataSchemaVersion: 3,
          version: '1.0.0',
          state: 'Draft',
        },
      ],
    })
    expect(r.success).toBe(true)
  })

  it('accepts a spec update', () => {
    const r = BatchSaveRequest.safeParse({
      ...EMPTY,
      specs: [{ op: 'update', id: 's1', name: 'Renamed' }],
    })
    expect(r.success).toBe(true)
  })

  it('accepts a spec delete', () => {
    const r = BatchSaveRequest.safeParse({
      ...EMPTY,
      specs: [{ op: 'delete', id: 's1' }],
    })
    expect(r.success).toBe(true)
  })

  it('rejects unknown field in a spec entry (strict)', () => {
    const r = BatchSaveRequest.safeParse({
      ...EMPTY,
      specs: [{ op: 'update', id: 's1', bogus: true }],
    })
    expect(r.success).toBe(false)
  })

  it('rejects libraryVersionGuards (removed)', () => {
    const r = BatchSaveRequest.safeParse({
      ...EMPTY,
      libraryVersionGuards: [{ libraryId: 'lib1', expectedRowVersion: 7 }],
    })
    expect(r.success).toBe(false)
  })

  it('accepts proxyRefs + specEnvs + imageRefs + imageDeletes', () => {
    const r = BatchSaveRequest.safeParse({
      specs: [],
      proxyRefs: [{ op: 'create', parentSpecificationId: 's1', nodeId: 'n1', targetSpecificationId: 's2' }],
      specEnvs: [{ op: 'create', specificationId: 's1', environmentLibraryId: 'libE' }],
      imageDeletes: [{ specificationId: 's1', filename: 'old.png' }],
      imageRefs: [{ op: 'create', specificationId: 's1', imageId: 'i1' }],
    })
    expect(r.success).toBe(true)
  })
})

describe('BatchSaveRequest typeName', () => {
  const upd = (extra: Record<string, unknown>) =>
    BatchSaveRequest.safeParse({ ...EMPTY, specs: [{ op: 'update', id: 's1', ...extra }] })
  const typeOf = (r: ReturnType<typeof upd>) =>
    r.success ? (r.data.specs[0] as { typeName?: string | null }).typeName : 'FAIL'

  it('accepts and trims a type name on update', () => {
    expect(typeOf(upd({ typeName: 'Operation' }))).toBe('Operation')
    expect(typeOf(upd({ typeName: '  Operation ' }))).toBe('Operation')
  })
  it('normalizes blank to null, keeps null, leaves absent undefined', () => {
    expect(typeOf(upd({ typeName: '  ' }))).toBeNull()
    expect(typeOf(upd({ typeName: null }))).toBeNull()
    expect(typeOf(upd({}))).toBeUndefined()
  })
  it('rejects 51 characters but accepts 50 (after trimming)', () => {
    expect(upd({ typeName: 'x'.repeat(51) }).success).toBe(false)
    expect(upd({ typeName: 'x'.repeat(50) }).success).toBe(true)
    expect(upd({ typeName: ` ${'x'.repeat(50)} ` }).success).toBe(true)
  })
  it('accepts a type name on create', () => {
    const r = BatchSaveRequest.safeParse({
      ...EMPTY,
      specs: [
        {
          op: 'create',
          id: 'n',
          rootSpecificationId: 'n',
          name: 'R',
          data: '{}',
          dataSchemaVersion: 3,
          typeName: ' Phase ',
        },
      ],
    })
    expect(r.success).toBe(true)
    if (r.success) expect((r.data.specs[0] as { typeName?: string | null }).typeName).toBe('Phase')
  })
})
