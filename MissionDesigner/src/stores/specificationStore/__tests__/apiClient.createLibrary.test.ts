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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { api } from '@/stores/specificationStore/apiClient'

describe('api.createLibrary (Phase 5d create→team wiring)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ library: { id: 'lib1' } }) })),
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it('posts teamId in the request body', async () => {
    await api.createLibrary({ name: 'L', entityType: 'workflow', teamId: 'team-a' })
    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit
    expect(JSON.parse(init.body as string)).toMatchObject({ name: 'L', entityType: 'workflow', teamId: 'team-a' })
  })
})
