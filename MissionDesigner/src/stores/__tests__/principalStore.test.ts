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

import { describe, it, expect, beforeEach } from 'vitest'
import { usePrincipalStore, principalHasRight, principalCan, principalHasRightInAnyTeam } from '../principalStore'
import type { MePrincipal } from '../specificationStore/apiClient'

const SAMPLE: MePrincipal = {
  userId: 'u1',
  isAdministrator: false,
  memberships: ['team-a', 'team-b'],
  rightsByTeam: { 'team-a': ['workflow:create', 'workflow:edit'], 'team-b': ['action:approve'] },
  teams: [
    { id: 'team-a', name: 'Alpha' },
    { id: 'team-b', name: 'Beta' },
  ],
}

beforeEach(() => {
  usePrincipalStore.getState().clearPrincipal()
})

describe('principalStore', () => {
  it('starts empty (null) before boot', () => {
    expect(usePrincipalStore.getState().principal).toBeNull()
  })

  it('setPrincipal stores the principal; clearPrincipal resets it', () => {
    usePrincipalStore.getState().setPrincipal(SAMPLE)
    expect(usePrincipalStore.getState().principal?.userId).toBe('u1')
    usePrincipalStore.getState().clearPrincipal()
    expect(usePrincipalStore.getState().principal).toBeNull()
  })
})

describe('principalHasRight', () => {
  it('true when the principal holds the right in that team', () => {
    expect(principalHasRight(SAMPLE, 'team-a', 'workflow:create')).toBe(true)
    expect(principalHasRight(SAMPLE, 'team-b', 'action:approve')).toBe(true)
  })

  it('false when the right is held in a different team or not at all', () => {
    expect(principalHasRight(SAMPLE, 'team-b', 'workflow:create')).toBe(false)
    expect(principalHasRight(SAMPLE, 'team-a', 'workflow:delete')).toBe(false)
    expect(principalHasRight(SAMPLE, 'team-z', 'workflow:create')).toBe(false)
  })

  it('false for a null principal', () => {
    expect(principalHasRight(null, 'team-a', 'workflow:create')).toBe(false)
  })

  it('an administrator holds every right in every team', () => {
    const admin: MePrincipal = { ...SAMPLE, isAdministrator: true, rightsByTeam: {}, memberships: [] }
    expect(principalHasRight(admin, 'team-a', 'workflow:create')).toBe(true)
    expect(principalHasRight(admin, 'any-team', 'action:makeEffective')).toBe(true)
  })
})

const base: MePrincipal = {
  userId: 'u1',
  isAdministrator: false,
  memberships: ['team-a'],
  rightsByTeam: { 'team-a': ['workflow:edit', 'workflow:library.create'] },
  teams: [{ id: 'team-a', name: 'A' }],
  editLockedStates: ['Approved', 'Effective', 'Superseded', 'Obsolete'],
}

describe('principalCan', () => {
  it('null principal holds nothing', () => {
    expect(principalCan(null, { teamId: 'team-a', entityType: 'workflow' }, 'edit')).toBe(false)
  })

  it('admin can do anything, even on a null-team library', () => {
    const admin = { ...base, isAdministrator: true }
    expect(principalCan(admin, { teamId: null, entityType: 'workflow' }, 'edit')).toBe(true)
  })

  it('returns false when the library teamId is null (non-admin)', () => {
    expect(principalCan(base, { teamId: null, entityType: 'workflow' }, 'edit')).toBe(false)
    expect(principalCan(base, undefined, 'edit')).toBe(false)
  })

  it('maps entityType→category and checks the team right (step folds into workflow)', () => {
    expect(principalCan(base, { teamId: 'team-a', entityType: 'workflow' }, 'edit')).toBe(true)
    expect(principalCan(base, { teamId: 'team-a', entityType: 'step' }, 'edit')).toBe(true)
    expect(principalCan(base, { teamId: 'team-a', entityType: 'workflow' }, 'delete')).toBe(false)
    expect(principalCan(base, { teamId: 'team-b', entityType: 'workflow' }, 'edit')).toBe(false)
    expect(principalCan(base, { teamId: 'team-a', entityType: 'action' }, 'edit')).toBe(false)
  })
})

describe('principalHasRightInAnyTeam', () => {
  it('true if the right is held in any team; admin always true; null false', () => {
    expect(principalHasRightInAnyTeam(base, 'workflow:library.create')).toBe(true)
    expect(principalHasRightInAnyTeam(base, 'action:library.create')).toBe(false)
    expect(principalHasRightInAnyTeam({ ...base, isAdministrator: true }, 'action:library.create')).toBe(true)
    expect(principalHasRightInAnyTeam(null, 'workflow:library.create')).toBe(false)
  })
})
