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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  listTeams,
  createTeam,
  deleteTeam,
  setMemberRoles,
  getEditLockedStates,
  listUsers,
  setUserAdmin,
  deleteUser,
  listUserMemberships,
  AdminApiError,
  adminErrorMessage,
} from '../adminClient'
import { RIGHTS_CATEGORIES, RIGHT_VERBS, rightId, summarizeRights } from '../rightsCatalog'
import { RIGHTS } from '../../../server/authz/rights'

function mockFetchOnce(status: number, body?: unknown) {
  const res = {
    ok: status >= 200 && status < 300,
    status,
    json: () => (body === undefined ? Promise.reject(new Error('no body')) : Promise.resolve(body)),
  } as Response
  vi.mocked(fetch).mockResolvedValueOnce(res)
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('adminClient', () => {
  it('unwraps the {teams} collection envelope', async () => {
    mockFetchOnce(200, {
      teams: [{ id: 't1', name: 'A', description: null, createdAt: 1, updatedAt: 1, memberCount: 2, libraryCount: 3 }],
    })
    const teams = await listTeams()
    expect(teams).toHaveLength(1)
    expect(teams[0].memberCount).toBe(2)
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/v2/admin/teams')
  })

  it('treats 204 as success with no body', async () => {
    mockFetchOnce(204)
    await expect(deleteTeam('t1')).resolves.toBeUndefined()
  })

  it('throws AdminApiError carrying the v2 code and extras', async () => {
    mockFetchOnce(409, { code: 'team_not_empty', reason: 'owns_libraries' })
    const err = (await deleteTeam('t1').catch((e) => e)) as AdminApiError
    expect(err).toBeInstanceOf(AdminApiError)
    expect(err.status).toBe(409)
    expect(err.code).toBe('team_not_empty')
    expect(err.extra).toEqual({ reason: 'owns_libraries' })
  })

  it('falls back to code "internal" on a non-JSON error body', async () => {
    mockFetchOnce(502)
    const err = (await listTeams().catch((e) => e)) as AdminApiError
    expect(err).toBeInstanceOf(AdminApiError)
    expect(err.code).toBe('internal')
  })

  it('setMemberRoles PUTs the replace-set and unwraps the bare {roleIds} envelope', async () => {
    mockFetchOnce(200, { roleIds: ['role-author'] })
    expect(await setMemberRoles('t1', 'u1', ['role-author'])).toEqual(['role-author'])
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('/api/v2/admin/teams/t1/members/u1/roles')
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(init?.body as string)).toEqual({ roleIds: ['role-author'] })
  })

  it('getEditLockedStates unwraps the bare {states} envelope', async () => {
    mockFetchOnce(200, { states: ['Approved'] })
    expect(await getEditLockedStates()).toEqual(['Approved'])
  })

  it('createTeam POSTs JSON and unwraps the {team} envelope', async () => {
    mockFetchOnce(201, { team: { id: 't9', name: 'QA', description: null, createdAt: 1, updatedAt: 1 } })
    const team = await createTeam({ name: 'QA' })
    expect(team.id).toBe('t9')
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('/api/v2/admin/teams')
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(JSON.parse(init?.body as string)).toEqual({ name: 'QA' })
  })
})

describe('adminClient — users (v2)', () => {
  it('listUsers hits /api/v2/admin/users and unwraps {users}', async () => {
    mockFetchOnce(200, {
      users: [{ id: 'u1', name: 'A', email: 'a@x.com', isAdministrator: true, createdAt: null }],
    })
    const users = await listUsers()
    expect(users[0].isAdministrator).toBe(true)
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/v2/admin/users')
  })

  it('setUserAdmin PATCHes {isAdministrator} and unwraps {user}', async () => {
    mockFetchOnce(200, { user: { id: 'u1', name: 'A', email: 'a@x.com', isAdministrator: false, createdAt: null } })
    const updated = await setUserAdmin('u1', false)
    expect(updated.isAdministrator).toBe(false)
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('/api/v2/admin/users/u1')
    expect(init?.method).toBe('PATCH')
    expect(JSON.parse(init?.body as string)).toEqual({ isAdministrator: false })
  })

  it('deleteUser DELETEs and treats 204 as success', async () => {
    mockFetchOnce(204)
    await expect(deleteUser('u1')).resolves.toBeUndefined()
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('/api/v2/admin/users/u1')
    expect(init?.method).toBe('DELETE')
  })

  it('listUserMemberships GETs and unwraps the {memberships} envelope', async () => {
    mockFetchOnce(200, { memberships: [{ teamId: 't1', teamName: 'Alpha', roleIds: ['role-author'] }] })
    const m = await listUserMemberships('u1')
    expect(m).toEqual([{ teamId: 't1', teamName: 'Alpha', roleIds: ['role-author'] }])
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/v2/admin/users/u1/memberships')
  })
})

describe('adminErrorMessage', () => {
  it('maps the codes this surface can return', () => {
    expect(adminErrorMessage(new AdminApiError(409, 'team_not_empty'), 'f')).toMatch(/owns libraries/i)
    expect(adminErrorMessage(new AdminApiError(409, 'global_team_protected'), 'f')).toMatch(/GLOBAL team/i)
    expect(adminErrorMessage(new AdminApiError(409, 'conflict'), 'f')).toMatch(/already in use/i)
    expect(adminErrorMessage(new AdminApiError(404, 'not_found'), 'f')).toMatch(/deleted/i)
    expect(adminErrorMessage(new AdminApiError(403, 'forbidden'), 'f')).toMatch(/administrator/i)
    expect(adminErrorMessage(new AdminApiError(409, 'last_admin'), 'f')).toMatch(/administrator is required/i)
  })

  it('uses the fallback for unknown codes and non-Error values', () => {
    expect(adminErrorMessage(new AdminApiError(500, 'weird_code'), 'fallback')).toBe('fallback')
    expect(adminErrorMessage('not-an-error', 'fallback')).toBe('fallback')
  })
})

describe('rightsCatalog', () => {
  it('the grid composes exactly the server rights catalog (21 rights)', () => {
    const grid = RIGHTS_CATEGORIES.flatMap((c) => RIGHT_VERBS.map((v) => rightId(c, v.verb)))
    expect([...grid].sort()).toEqual([...RIGHTS].sort())
  })

  it('summarizeRights groups by category in catalog order', () => {
    expect(summarizeRights(['action:edit', 'workflow:create', 'workflow:edit'])).toBe(
      'workflow: create, edit · action: edit',
    )
  })
})
