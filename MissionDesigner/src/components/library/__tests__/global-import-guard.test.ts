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
import { mayAddSpecsTo, mayImportLibraryInto } from '../global-import-guard'
import type { MePrincipal } from '@/stores/specificationStore/apiClient'

const principal = (rights: Record<string, string[]>, isAdministrator = false): MePrincipal => ({
  userId: 'u',
  isAdministrator,
  memberships: Object.keys(rights),
  rightsByTeam: rights,
  teams: [],
})

describe('mayAddSpecsTo', () => {
  const globalLib = { teamId: 'team-global', entityType: 'action' }

  it("team libraries keep today's behaviour (the server decides)", () => {
    expect(mayAddSpecsTo({ teamId: 'team-main', entityType: 'action' }, principal({}))).toBe(true)
  })

  it('a GLOBAL library needs the create right in GLOBAL', () => {
    expect(mayAddSpecsTo(globalLib, principal({ 'team-main': ['action:create'] }))).toBe(false)
    expect(mayAddSpecsTo(globalLib, principal({ 'team-global': ['action:create'] }))).toBe(true)
  })

  it('admins may always add', () => {
    expect(mayAddSpecsTo(globalLib, principal({}, true))).toBe(true)
  })
})

describe('mayImportLibraryInto — the sidebar Import button', () => {
  it('an action, environment or step import needs library.create in the selected team', () => {
    const author = principal({ 'team-main': ['action:library.create'] })
    expect(mayImportLibraryInto(author, 'team-main', 'action')).toBe(true)
    expect(mayImportLibraryInto(author, 'team-global', 'action')).toBe(false)
  })

  it('with GLOBAL selected, a person with rights in GLOBAL may import', () => {
    expect(mayImportLibraryInto(principal({ 'team-global': ['action:library.create'] }), 'team-global', 'action')).toBe(
      true,
    )
  })

  it('a workflow import needs a team other than GLOBAL to land in, whatever is selected', () => {
    expect(
      mayImportLibraryInto(principal({ 'team-global': ['workflow:library.create'] }), 'team-global', 'workflow'),
    ).toBe(false)
    expect(
      mayImportLibraryInto(principal({ 'team-main': ['workflow:library.create'] }), 'team-global', 'workflow'),
    ).toBe(true)
  })

  it('no team selected keeps the any-team rule; admins may always import', () => {
    expect(mayImportLibraryInto(principal({ 'team-main': ['workflow:library.create'] }), null, 'step')).toBe(true)
    expect(mayImportLibraryInto(principal({}, true), 'team-global', 'action')).toBe(true)
  })
})
