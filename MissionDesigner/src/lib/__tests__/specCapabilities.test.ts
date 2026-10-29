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
import { specRowCapabilities } from '@/lib/specCapabilities'
import type { MePrincipal } from '@/stores/specificationStore/apiClient'

const lib = { teamId: 'team-a', entityType: 'workflow' }
const p = (rights: string[], admin = false): MePrincipal => ({
  userId: 'u1',
  isAdministrator: admin,
  memberships: ['team-a'],
  rightsByTeam: { 'team-a': rights },
  teams: [{ id: 'team-a', name: 'A' }],
  editLockedStates: ['Approved', 'Effective', 'Superseded', 'Obsolete'],
})

describe('specRowCapabilities', () => {
  it('viewer (no rights) gets nothing', () => {
    expect(specRowCapabilities(p([]), lib, 'Draft')).toEqual({
      canChangeState: false,
      canCreateVersion: false,
      canDeleteSpec: false,
    })
  })

  it('approver can change state of a Draft (Draft→Approved) but not version/delete', () => {
    const c = specRowCapabilities(p(['workflow:approve']), lib, 'Draft')
    expect(c.canChangeState).toBe(true)
    expect(c.canCreateVersion).toBe(false)
    expect(c.canDeleteSpec).toBe(false)
  })

  it('publisher can change state of an Approved spec (Approved→Effective/…)', () => {
    expect(specRowCapabilities(p(['workflow:makeEffective']), lib, 'Approved').canChangeState).toBe(true)
  })

  it('author (edit/create/delete) on Draft: change-state (edit-band), new version, and delete', () => {
    const c = specRowCapabilities(p(['workflow:edit', 'workflow:create', 'workflow:delete']), lib, 'Draft')
    expect(c).toEqual({ canChangeState: true, canCreateVersion: true, canDeleteSpec: true })
  })

  it('delete is blocked on an edit-locked state (Approved) but allowed on Obsolete', () => {
    expect(specRowCapabilities(p(['workflow:delete']), lib, 'Approved').canDeleteSpec).toBe(false)
    expect(specRowCapabilities(p(['workflow:delete']), lib, 'Obsolete').canDeleteSpec).toBe(true)
  })

  it('admin gets everything; null principal/library get nothing', () => {
    expect(specRowCapabilities(p([], true), lib, 'Approved')).toEqual({
      canChangeState: true,
      canCreateVersion: true,
      canDeleteSpec: true,
    })
    expect(specRowCapabilities(null, lib, 'Draft').canChangeState).toBe(false)
    expect(specRowCapabilities(p(['workflow:approve']), null, 'Draft').canChangeState).toBe(false)
  })

  it('rights in another team do not apply', () => {
    expect(
      specRowCapabilities(p(['workflow:approve']), { teamId: 'team-b', entityType: 'workflow' }, 'Draft')
        .canChangeState,
    ).toBe(false)
  })
})
