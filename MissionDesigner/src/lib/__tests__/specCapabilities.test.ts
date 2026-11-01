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
      canMoveToLibrary: false,
      canMoveToTeam: false,
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
    expect(c).toEqual({
      canChangeState: true,
      canCreateVersion: true,
      canDeleteSpec: true,
      canMoveToLibrary: false,
      canMoveToTeam: false,
    })
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
      canMoveToLibrary: true,
      canMoveToTeam: false, // admin, but only one team exists in this fixture
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

describe('specRowCapabilities — move', () => {
  const LIB = ['workflow:library.create', 'workflow:library.delete']
  const two = (rights: Record<string, string[]>, admin = false): MePrincipal => ({
    userId: 'u1',
    isAdministrator: admin,
    memberships: ['team-a', 'team-b', 'team-global'],
    rightsByTeam: rights,
    teams: [
      { id: 'team-a', name: 'A' },
      { id: 'team-b', name: 'B' },
      { id: 'team-global', name: 'GLOBAL', isGlobal: true },
    ],
    editLockedStates: [],
  })

  it('Librarian on a workflow library can move to library and, with a qualifying other team, to team', () => {
    const c = specRowCapabilities(two({ 'team-a': LIB, 'team-b': LIB }), lib, 'Draft')
    expect(c.canMoveToLibrary).toBe(true)
    expect(c.canMoveToTeam).toBe(true)
  })

  it('needs both library.create and library.delete', () => {
    expect(specRowCapabilities(two({ 'team-a': [LIB[0]] }), lib, 'Draft').canMoveToLibrary).toBe(false)
    expect(specRowCapabilities(two({ 'team-a': [LIB[1]] }), lib, 'Draft').canMoveToLibrary).toBe(false)
  })

  it('Author only gets neither', () => {
    const c = specRowCapabilities(
      two({ 'team-a': ['workflow:edit', 'workflow:create', 'workflow:delete'] }),
      lib,
      'Draft',
    )
    expect(c.canMoveToLibrary).toBe(false)
    expect(c.canMoveToTeam).toBe(false)
  })

  it('move to team is false when the other team lacks the Librarian pair, or only GLOBAL is left', () => {
    expect(specRowCapabilities(two({ 'team-a': LIB, 'team-b': [LIB[0]] }), lib, 'Draft').canMoveToTeam).toBe(false)
    const onlyGlobal = two({ 'team-a': LIB, 'team-global': LIB })
    onlyGlobal.teams = onlyGlobal.teams.filter((t) => t.id !== 'team-b')
    expect(specRowCapabilities(onlyGlobal, lib, 'Draft').canMoveToTeam).toBe(false)
  })

  it('move to team is false for environment and action libraries', () => {
    for (const entityType of ['environment', 'action']) {
      const r = ['team-a', 'team-b'].reduce(
        (acc, t) => ({ ...acc, [t]: [`${entityType}:library.create`, `${entityType}:library.delete`, ...LIB] }),
        {},
      )
      const c = specRowCapabilities(two(r), { teamId: 'team-a', entityType }, 'Draft')
      expect(c.canMoveToLibrary).toBe(true)
      expect(c.canMoveToTeam).toBe(false)
    }
  })

  it('step libraries cannot be moved, even by an administrator', () => {
    const c = specRowCapabilities(
      p(['step:library.create', 'step:library.delete'], true),
      { teamId: 'team-a', entityType: 'step' },
      'Draft',
    )
    expect(c.canMoveToLibrary).toBe(false)
    expect(c.canMoveToTeam).toBe(false)
  })

  it('workflow Librarian has no move rights on an environment library', () => {
    expect(
      specRowCapabilities(two({ 'team-a': LIB }), { teamId: 'team-a', entityType: 'environment' }, 'Draft')
        .canMoveToLibrary,
    ).toBe(false)
  })

  it('admin with another non-GLOBAL team can move to team', () => {
    expect(specRowCapabilities(two({}, true), lib, 'Draft').canMoveToTeam).toBe(true)
  })
})
