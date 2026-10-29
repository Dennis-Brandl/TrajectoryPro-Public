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

// Typed wrappers over the admin REST surface (/api/v2/admin/*, gated by
// requireV2Admin). Every call takes an admin-authenticated APIRequestContext —
// create one with request.newContext({ storageState }) using the storageState
// global-setup.ts persists. All mutations carry an Origin header the dev
// CORS/CSRF layer trusts (any localhost in development).

import type { APIRequestContext, APIResponse } from '@playwright/test'

/** API server the E2E harness boots on (playwright.config webServer / dev-start). */
const API_BASE = 'http://localhost:3001'
/** Origin the dev origin/CORS layer trusts — Vite's dev port. */
const ORIGIN = 'http://localhost:5174'

const jsonHeaders = { 'Content-Type': 'application/json', Origin: ORIGIN }

async function expectOk(res: APIResponse, label: string): Promise<void> {
  if (!res.ok()) {
    const body = await res.text()
    throw new Error(`${label} failed: ${res.status()} ${body}`)
  }
}

export interface CreateUserOpts {
  email: string
  password: string
  name?: string
  isAdministrator?: boolean
}

/**
 * POST /api/v2/admin/users → created user id. Uses auth.$context internally, so
 * it bypasses the public sign-up gate (the only way to add users post-setup).
 * Throws on 409 (duplicate email) or any non-2xx.
 */
export async function createUser(request: APIRequestContext, opts: CreateUserOpts): Promise<{ id: string }> {
  const res = await request.post(`${API_BASE}/api/v2/admin/users`, { headers: jsonHeaders, data: opts })
  await expectOk(res, 'createUser')
  const body = (await res.json()) as { user: { id: string } }
  return { id: body.user.id }
}

/** POST /api/v2/admin/teams → created team id. */
export async function createTeam(
  request: APIRequestContext,
  opts: { name: string; description?: string },
): Promise<{ id: string }> {
  const res = await request.post(`${API_BASE}/api/v2/admin/teams`, { headers: jsonHeaders, data: opts })
  await expectOk(res, 'createTeam')
  const body = (await res.json()) as { team: { id: string } }
  return { id: body.team.id }
}

/** POST /api/v2/libraries → created library id (201). Admin holds library.create in every team. */
export async function createLibrary(
  request: APIRequestContext,
  opts: {
    name: string
    entityType: 'workflow' | 'step' | 'environment' | 'action'
    teamId: string
    description?: string
  },
): Promise<{ id: string }> {
  const res = await request.post(`${API_BASE}/api/v2/libraries`, { headers: jsonHeaders, data: opts })
  await expectOk(res, 'createLibrary')
  const body = (await res.json()) as { library: { id: string } }
  return { id: body.library.id }
}

/**
 * PUT /api/v2/admin/teams/:teamId/members/:userId → 204. Grants visibility
 * (membership) with no roles — the "viewer" persona.
 */
export async function addMember(request: APIRequestContext, teamId: string, userId: string): Promise<void> {
  const res = await request.put(`${API_BASE}/api/v2/admin/teams/${teamId}/members/${userId}`, {
    headers: { Origin: ORIGIN },
  })
  await expectOk(res, 'addMember')
}

/**
 * PUT /api/v2/admin/teams/:teamId/members/:userId/roles → assigned role ids.
 * Auto-creates the membership if absent (capability implies visibility).
 */
export async function setMemberRoles(
  request: APIRequestContext,
  teamId: string,
  userId: string,
  roleIds: string[],
): Promise<string[]> {
  const res = await request.put(`${API_BASE}/api/v2/admin/teams/${teamId}/members/${userId}/roles`, {
    headers: jsonHeaders,
    data: { roleIds },
  })
  await expectOk(res, 'setMemberRoles')
  const body = (await res.json()) as { roleIds: string[] }
  return body.roleIds
}

/**
 * POST /api/v2/admin/role-templates/apply → seeds the named seed roles into the
 * global catalog (boot no longer seeds them — the wizard / this call does).
 * Canonical ids: role-author, role-approver, role-publisher, role-librarian.
 */
export async function applyRoleTemplates(request: APIRequestContext, roleIds: string[]): Promise<void> {
  const res = await request.post(`${API_BASE}/api/v2/admin/role-templates/apply`, {
    headers: jsonHeaders,
    data: { roleIds },
  })
  await expectOk(res, 'applyRoleTemplates')
}

/** POST /api/v2/admin/setup-complete → flips setupComplete (requires >=1 admin AND >=1 team). */
export async function markSetupComplete(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${API_BASE}/api/v2/admin/setup-complete`, { headers: { Origin: ORIGIN } })
  await expectOk(res, 'markSetupComplete')
}
