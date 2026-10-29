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

// Typed client for the /api/v2/admin/* management surface (Phase 4b + the Phase
// 5d accounts/users surface). v2 error bodies are { code, ...extra } — the HTTP
// status is wire-only (design D15); the UI maps codes to human-readable toasts
// via adminErrorMessage.
//
// Envelope contract (4a): collections come wrapped ({teams}/{roles}/{members}),
// singles too ({team}/{role}), but settings and role assignment return bare
// {states}/{roleIds}.

import type { SpecificationState } from '../../types/library'

export interface Team {
  id: string
  name: string
  description: string | null
  createdAt: number
  updatedAt: number
}

export interface TeamWithCounts extends Team {
  memberCount: number
  libraryCount: number
}

export interface TeamMember {
  userId: string
  email: string
  name: string | null
  roleIds: string[]
}

export interface Role {
  id: string
  name: string
  description: string | null
  isSeeded: number
  rights: string[]
  assignmentCount: number
}

export interface RoleTemplate {
  id: string
  name: string
  description: string
  rights: string[]
}

export interface UserAccount {
  id: string
  name: string | null
  email: string
  isAdministrator: boolean
  createdAt: string | null
}

export interface UserMembership {
  teamId: string
  teamName: string
  roleIds: string[]
}

/** Lifecycle order — the canonical order the server stores and returns. */
export const ALL_SPECIFICATION_STATES: readonly SpecificationState[] = [
  'Draft',
  'InTest',
  'InReview',
  'Approved',
  'Effective',
  'Superseded',
  'Obsolete',
] as const

export class AdminApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(`${status} ${code}`)
    this.name = 'AdminApiError'
  }
}

/** Maps an AdminApiError to toast text; other values get the fallback. */
export function adminErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof AdminApiError)) return err instanceof Error ? err.message : fallback
  switch (err.code) {
    case 'team_not_empty':
      return 'This team still owns libraries — delete or reassign them first.'
    case 'global_team_protected':
      return 'The GLOBAL team is built in — it cannot be renamed or deleted.'
    case 'conflict':
      return 'That name is already in use.'
    case 'not_found':
      return 'Not found — it may have been deleted. Refresh and try again.'
    case 'forbidden':
      return 'Administrator access required.'
    case 'schema_mismatch':
      return 'Invalid input.'
    case 'rate_limited':
      return 'Too many requests — try again shortly.'
    case 'last_admin':
      return 'At least one administrator is required.'
    case 'setup_incomplete':
      return 'Create at least one administrator and one team before finishing setup.'
    default:
      return fallback
  }
}

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: init?.body !== undefined ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  })
  if (!res.ok) {
    let code = 'internal'
    let extra: Record<string, unknown> = {}
    try {
      const body = (await res.json()) as Record<string, unknown>
      if (typeof body.code === 'string') {
        const { code: bodyCode, ...rest } = body
        code = bodyCode
        extra = rest
      }
    } catch {
      // non-JSON body (proxy error page etc.) — keep the 'internal' fallback
    }
    throw new AdminApiError(res.status, code, extra)
  }
  // Safe only because all 204 endpoints are typed Promise<void> by their callers.
  if (res.status === 204) return undefined as T
  try {
    return (await res.json()) as T
  } catch {
    // 2xx with a non-JSON/empty body (truncating proxy, contract violation) —
    // keep every failure inside the AdminApiError surface.
    throw new AdminApiError(res.status, 'internal', { reason: 'invalid_json' })
  }
}

// ---- teams ----

export async function listTeams(): Promise<TeamWithCounts[]> {
  return (await adminFetch<{ teams: TeamWithCounts[] }>('/api/v2/admin/teams')).teams
}

export async function createTeam(input: { name: string; description?: string }): Promise<Team> {
  return (await adminFetch<{ team: Team }>('/api/v2/admin/teams', { method: 'POST', body: JSON.stringify(input) })).team
}

export async function patchTeam(id: string, patch: { name?: string; description?: string | null }): Promise<Team> {
  return (
    await adminFetch<{ team: Team }>(`/api/v2/admin/teams/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
  ).team
}

export async function deleteTeam(id: string): Promise<void> {
  await adminFetch<void>(`/api/v2/admin/teams/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// ---- libraries ----

/** Moves a root library and its child libraries to another team (spec 2026-10-12 §4.7). Without
 *  `force`, a move that would cut other teams off answers 409 conflict/referenced with a count. */
export async function moveLibrary(id: string, teamId: string, force = false): Promise<{ moved: number }> {
  return adminFetch<{ moved: number }>(`/api/v2/admin/libraries/${encodeURIComponent(id)}/move`, {
    method: 'POST',
    body: JSON.stringify(force ? { teamId, force } : { teamId }),
  })
}

// ---- members ----

export async function listMembers(teamId: string): Promise<TeamMember[]> {
  return (await adminFetch<{ members: TeamMember[] }>(`/api/v2/admin/teams/${encodeURIComponent(teamId)}/members`))
    .members
}

export async function addMember(teamId: string, userId: string): Promise<void> {
  await adminFetch<void>(`/api/v2/admin/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`, {
    method: 'PUT',
  })
}

export async function removeMember(teamId: string, userId: string): Promise<void> {
  await adminFetch<void>(`/api/v2/admin/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  })
}

/** Replace-set role assignment; returns the stored set. Auto-creates membership (4a invariant). */
export async function setMemberRoles(teamId: string, userId: string, roleIds: string[]): Promise<string[]> {
  return (
    await adminFetch<{ roleIds: string[] }>(
      `/api/v2/admin/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}/roles`,
      { method: 'PUT', body: JSON.stringify({ roleIds }) },
    )
  ).roleIds
}

// ---- roles ----

export async function listRoles(): Promise<Role[]> {
  return (await adminFetch<{ roles: Role[] }>('/api/v2/admin/roles')).roles
}

export async function getRole(id: string): Promise<Role> {
  return (await adminFetch<{ role: Role }>(`/api/v2/admin/roles/${encodeURIComponent(id)}`)).role
}

export async function createRole(input: { name: string; description?: string; rights: string[] }): Promise<Role> {
  return (await adminFetch<{ role: Role }>('/api/v2/admin/roles', { method: 'POST', body: JSON.stringify(input) })).role
}

export async function patchRole(
  id: string,
  patch: { name?: string; description?: string | null; rights?: string[] },
): Promise<Role> {
  return (
    await adminFetch<{ role: Role }>(`/api/v2/admin/roles/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
  ).role
}

export async function deleteRole(id: string): Promise<void> {
  await adminFetch<void>(`/api/v2/admin/roles/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// ---- settings ----

export async function getEditLockedStates(): Promise<SpecificationState[]> {
  return (await adminFetch<{ states: SpecificationState[] }>('/api/v2/admin/settings/edit-locked-states')).states
}

export async function putEditLockedStates(states: SpecificationState[]): Promise<SpecificationState[]> {
  return (
    await adminFetch<{ states: SpecificationState[] }>('/api/v2/admin/settings/edit-locked-states', {
      method: 'PUT',
      body: JSON.stringify({ states }),
    })
  ).states
}

export async function getEsignatureRoles(): Promise<string[]> {
  return (await adminFetch<{ roles: string[] }>('/api/v2/admin/settings/esignature-roles')).roles
}

export async function putEsignatureRoles(roles: string[]): Promise<string[]> {
  return (
    await adminFetch<{ roles: string[] }>('/api/v2/admin/settings/esignature-roles', {
      method: 'PUT',
      body: JSON.stringify({ roles }),
    })
  ).roles
}

// ---- users (/api/v2/admin/users — Phase 5d slice 4) ----

export async function listUsers(): Promise<UserAccount[]> {
  return (await adminFetch<{ users: UserAccount[] }>('/api/v2/admin/users')).users
}

export async function createUser(input: {
  email: string
  password: string
  name?: string
  isAdministrator?: boolean
}): Promise<UserAccount> {
  return (
    await adminFetch<{ user: UserAccount }>('/api/v2/admin/users', { method: 'POST', body: JSON.stringify(input) })
  ).user
}

export async function listUserMemberships(userId: string): Promise<UserMembership[]> {
  return (
    await adminFetch<{ memberships: UserMembership[] }>(`/api/v2/admin/users/${encodeURIComponent(userId)}/memberships`)
  ).memberships
}

export async function setUserAdmin(id: string, isAdministrator: boolean): Promise<UserAccount> {
  return (
    await adminFetch<{ user: UserAccount }>(`/api/v2/admin/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ isAdministrator }),
    })
  ).user
}

export async function deleteUser(id: string): Promise<void> {
  await adminFetch<void>(`/api/v2/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function setUserPassword(id: string, password: string): Promise<void> {
  await adminFetch<void>(`/api/v2/admin/users/${encodeURIComponent(id)}/password`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  })
}

// ---- setup (first-run wizard) ----

export async function getRoleTemplates(): Promise<RoleTemplate[]> {
  return (await adminFetch<{ roleTemplates: RoleTemplate[] }>('/api/v2/admin/role-templates')).roleTemplates
}

export async function applyRoleTemplates(roleIds: string[]): Promise<void> {
  await adminFetch<{ roles: unknown[] }>('/api/v2/admin/role-templates/apply', {
    method: 'POST',
    body: JSON.stringify({ roleIds }),
  })
}

export async function completeSetup(): Promise<{ setupComplete: boolean }> {
  return await adminFetch<{ setupComplete: boolean }>('/api/v2/admin/setup-complete', {
    method: 'POST',
    body: JSON.stringify({}),
  })
}
