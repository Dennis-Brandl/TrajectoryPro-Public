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

// Phase 35 §2.11 / Phase 5a: /api/v2/me — display-only capability endpoint.
// Server-side authz never trusts this; every permission check re-runs
// loadPrincipal (policy.ts) fresh. Carries isAdministrator (sourced from the
// v2 session) plus the team principal (memberships, per-team rights, teams).

import { GLOBAL_TEAM_ID } from '@/lib/global-team'
import { Hono } from 'hono'
import { rawQuery } from '../../lib/db'
import { loadPrincipal, editLockedStates } from '../../authz/policy'
import type { V2Session } from '../../middleware/v2/permissions'

type Variables = { v2Session: V2Session }

export const meV2 = new Hono<{ Variables: Variables }>()

meV2.get('/me', async (c) => {
  const session = c.get('v2Session')
  const principal = await loadPrincipal(session.userId)

  // memberships → array; rightsByTeam Map<Set> → plain Record<string[]>.
  const memberships = principal ? [...principal.memberships] : []
  const rightsByTeam: Record<string, string[]> = {}
  if (principal) {
    for (const [teamId, rights] of principal.rightsByTeam) rightsByTeam[teamId] = [...rights]
  }

  // teams[] drives the editor's team picker: an admin sees every team (admins
  // can see every library); a non-admin sees the teams they belong to plus GLOBAL, which
  // everyone can browse.
  // No LIMIT — team count is bounded by design (admin-only team creation).
  const [userRow] = await rawQuery<{ name: string | null }>('SELECT "name" FROM "user" WHERE "id" = $1', [
    session.userId,
  ])
  let teams: Array<{ id: string; name: string; isGlobal: boolean }> = []
  if (principal) {
    const rows = principal.isAdministrator
      ? await rawQuery<{ id: string; name: string }>('SELECT "id","name" FROM "team" ORDER BY "name"')
      : await rawQuery<{ id: string; name: string }>(
          `SELECT t."id" AS "id", t."name" AS "name"
             FROM "team" t
            WHERE t."id" = $2
               OR EXISTS (SELECT 1 FROM "user_team" ut WHERE ut."teamId" = t."id" AND ut."userId" = $1)
            ORDER BY t."name"`,
          [session.userId, GLOBAL_TEAM_ID],
        )
    // GLOBAL last, so the sidebar's default team stays the user's own (spec 2026-10-12 §4.2).
    teams = [...rows.filter((t) => t.id !== GLOBAL_TEAM_ID), ...rows.filter((t) => t.id === GLOBAL_TEAM_ID)].map(
      (t) => ({ ...t, isGlobal: t.id === GLOBAL_TEAM_ID }),
    )
  }

  return c.json({
    userId: session.userId,
    name: userRow?.name ?? null,
    isAdministrator: session.isAdministrator,
    memberships,
    rightsByTeam,
    teams,
    // Live, admin-tunable edit-lock list (design §6). Client uses it to grey out
    // the canvas; the server still re-checks every write. Reflects the value at
    // boot/login (refreshed on next /me).
    editLockedStates: [...(await editLockedStates())],
  })
})
