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
import { RIGHTS, ROLE_SEEDS, cat } from '../rights'

describe('rights catalog', () => {
  it('has exactly 21 rights (3 categories × 7 verbs)', () => {
    expect(new Set(RIGHTS).size).toBe(21)
  })

  it('maps step → workflow and leaves other categories identity', () => {
    expect(cat('step')).toBe('workflow')
    expect(cat('workflow')).toBe('workflow')
    expect(cat('environment')).toBe('environment')
    expect(cat('action')).toBe('action')
  })
})

describe('seeded roles', () => {
  it('seeds 16 roles (4 cross-category + 12 per-category)', () => {
    expect(ROLE_SEEDS).toHaveLength(16)
    expect(new Set(ROLE_SEEDS.map((r) => r.id)).size).toBe(16)
    expect(new Set(ROLE_SEEDS.map((r) => r.name)).size).toBe(16)
  })

  it('only references rights that exist in the catalog', () => {
    const valid = new Set(RIGHTS)
    for (const r of ROLE_SEEDS) {
      for (const right of r.rights) expect(valid.has(right), `${r.id} → ${right}`).toBe(true)
    }
  })

  it('cross-category bundles have the expected right counts', () => {
    const byId = Object.fromEntries(ROLE_SEEDS.map((r) => [r.id, r.rights]))
    expect(byId['role-author']).toHaveLength(9) // create+edit+delete × 3 categories
    expect(byId['role-approver']).toHaveLength(3) // approve × 3
    expect(byId['role-publisher']).toHaveLength(3) // makeEffective × 3
    expect(byId['role-librarian']).toHaveLength(6) // library.create+delete × 3
  })

  it('per-category Workflow Author covers only workflow object verbs', () => {
    const byId = Object.fromEntries(ROLE_SEEDS.map((r) => [r.id, r.rights]))
    expect([...byId['role-workflow-author']].sort()).toEqual(
      ['workflow:create', 'workflow:delete', 'workflow:edit'].sort(),
    )
  })
})
