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
import {
  GLOBAL_TEAM_ID,
  GLOBAL_TEAM_NAME,
  isGlobalTeam,
  allowedInGlobal,
  globalForbiddenEntityTypes,
  pickLibraryByName,
  libraryLabel,
  actionLibraryRefs,
  pickableLibraries,
  librariesForNames,
} from '../global-team'

const lib = (id: string, name: string, teamId: string | null, entityType = 'action') => ({
  id,
  name,
  teamId,
  entityType,
})

describe('GLOBAL identity', () => {
  it('is the fixed team id and name', () => {
    expect(GLOBAL_TEAM_ID).toBe('team-global')
    expect(GLOBAL_TEAM_NAME).toBe('GLOBAL')
    expect(isGlobalTeam('team-global')).toBe(true)
    expect(isGlobalTeam('team-main')).toBe(false)
    expect(isGlobalTeam(null)).toBe(false)
  })

  it('allows action, environment and step libraries, never workflow', () => {
    expect(['action', 'environment', 'step'].every(allowedInGlobal)).toBe(true)
    expect(allowedInGlobal('workflow')).toBe(false)
  })

  it('names the entity types that may not be written into GLOBAL', () => {
    expect(globalForbiddenEntityTypes(GLOBAL_TEAM_ID, ['action', 'workflow', 'step'])).toEqual(['workflow'])
    expect(globalForbiddenEntityTypes('team-main', ['workflow'])).toEqual([])
  })
})

describe('pickLibraryByName — the team library wins (U4)', () => {
  const team = lib('t', 'Distributed', 'team-main')
  const global = lib('g', 'Distributed', GLOBAL_TEAM_ID)
  const other = lib('o', 'Distributed', 'team-other')

  it('returns undefined when nothing matches', () => {
    expect(pickLibraryByName([team], 'Nope', 'action')).toBeUndefined()
  })

  it('matches on entity type as well as name', () => {
    expect(
      pickLibraryByName([lib('e', 'Distributed', 'team-main', 'environment')], 'Distributed', 'action'),
    ).toBeUndefined()
  })

  it('returns the only match, GLOBAL or not', () => {
    expect(pickLibraryByName([global], 'Distributed', 'action')).toBe(global)
    expect(pickLibraryByName([team], 'Distributed', 'action')).toBe(team)
  })

  it('prefers a team library over the GLOBAL one, whatever the order', () => {
    expect(pickLibraryByName([global, team], 'Distributed', 'action')).toBe(team)
    expect(pickLibraryByName([team, global], 'Distributed', 'action')).toBe(team)
  })

  it('prefers the given team when several teams have the name', () => {
    expect(pickLibraryByName([global, team, other], 'Distributed', 'action', 'team-other')).toBe(other)
  })

  it('falls back to the first non-GLOBAL when the preferred team has none', () => {
    expect(pickLibraryByName([global, team], 'Distributed', 'action', 'team-x')).toBe(team)
  })

  it('falls back to GLOBAL when only GLOBAL has it', () => {
    expect(pickLibraryByName([global], 'Distributed', 'action', 'team-main')).toBe(global)
  })
})

describe('libraryLabel', () => {
  it('suffixes GLOBAL libraries and leaves others alone', () => {
    expect(libraryLabel({ name: 'Distributed', teamId: GLOBAL_TEAM_ID })).toBe('Distributed (GLOBAL)')
    expect(libraryLabel({ name: 'Distributed', teamId: 'team-main' })).toBe('Distributed')
  })
})

describe('actionLibraryRefs', () => {
  it('maps each named action library to the team of the first environment naming it', () => {
    const envSpecs = [
      { libraryId: 'env-g', data: { included_actions: [{ action_library: 'X' }, { action_library: 'Y' }] } },
      { libraryId: 'env-a', data: { includedActions: [{ actionLibrary: 'X' }, { actionLibrary: 'Z' }] } },
      { libraryId: 'env-b', data: {} },
    ]
    const teams: Record<string, string> = { 'env-g': GLOBAL_TEAM_ID, 'env-a': 'team-a' }
    expect([...actionLibraryRefs(envSpecs, (id) => teams[id])]).toEqual([
      ['X', GLOBAL_TEAM_ID],
      ['Y', GLOBAL_TEAM_ID],
      ['Z', 'team-a'],
    ])
  })
})

describe('pickableLibraries — a picker offers only what a saved name resolves to', () => {
  const teamX = lib('a', 'X', 'team-a')
  const globalX = lib('g', 'X', GLOBAL_TEAM_ID)
  const globalY = lib('h', 'Y', GLOBAL_TEAM_ID)
  const otherX = lib('b', 'X', 'team-b')

  it("hides GLOBAL's X when the environment's team has its own X", () => {
    expect(pickableLibraries([globalX, teamX, globalY], 'action', 'team-a').map((l) => l.id)).toEqual(['a', 'h'])
  })

  it("offers GLOBAL's X when the environment's team has none, and drops other teams' shadowed copies", () => {
    expect(pickableLibraries([otherX, globalX], 'action', 'team-c').map((l) => l.id)).toEqual(['b'])
    expect(pickableLibraries([globalX, globalY], 'action', 'team-c').map((l) => l.id)).toEqual(['g', 'h'])
  })

  it('keeps every library of another entity type out', () => {
    expect(pickableLibraries([lib('e', 'X', 'team-a', 'environment')], 'action', 'team-a')).toEqual([])
  })
})

describe('librariesForNames — what an export needs to load', () => {
  it('returns only the library each name resolves to, not every same-named library', () => {
    const libs = [lib('g', 'X', GLOBAL_TEAM_ID), lib('a', 'X', 'team-a'), lib('h', 'Y', GLOBAL_TEAM_ID)]
    expect(librariesForNames(libs, ['X', 'Y', 'missing'], 'action', 'team-a').map((l) => l.id)).toEqual(['a', 'h'])
  })

  it('returns each library once even when the name repeats', () => {
    expect(librariesForNames([lib('a', 'X', 'team-a')], ['X', 'X'], 'action', null)).toHaveLength(1)
  })
})
