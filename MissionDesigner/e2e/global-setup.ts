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

// Playwright globalSetup. Runs once, after the webServer is up and against the
// fresh e2e DB (scripts/e2e-reset-db.mjs ran as part of the webServer command),
// so every spec starts from a ready, setup-complete app and reuses a persisted
// admin session instead of registering through the (removed) UI.
//
//   sign-up (first user auto-promoted → admin) → seed the role catalog →
//   create a default team → setup-complete → persist admin storageState + ids.

import { request, type APIRequestContext } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { bootstrapFirstAdmin } from './helpers/auth'
import { applyRoleTemplates, createTeam, markSetupComplete } from './helpers/admin'
import { ADMIN_CREDENTIALS, ADMIN_STORAGE_STATE } from './helpers/session'

const API_BASE = 'http://localhost:3001'
const ADMIN = ADMIN_CREDENTIALS
const SEED_ROLES = ['role-author', 'role-approver', 'role-publisher', 'role-librarian']
const STATE_FILE = 'e2e/.auth/state.json'

/** Poll the API until it answers — defensive against webServer/globalSetup ordering. */
async function waitForApi(ctx: APIRequestContext): Promise<void> {
  const deadline = Date.now() + 60_000
  for (;;) {
    try {
      const res = await ctx.get(`${API_BASE}/api/health`)
      if (res.ok()) return
    } catch {
      // server not up yet
    }
    if (Date.now() > deadline) throw new Error('E2E API did not become ready within 60s')
    await new Promise((r) => setTimeout(r, 500))
  }
}

export default async function globalSetup(): Promise<void> {
  const ctx = await request.newContext()
  try {
    await waitForApi(ctx)

    // After bootstrapFirstAdmin, ctx holds the admin session cookie — reuse it
    // for the admin-gated calls below.
    const admin = await bootstrapFirstAdmin(ctx, ADMIN)
    await applyRoleTemplates(ctx, SEED_ROLES)
    const team = await createTeam(ctx, { name: 'E2E Team' })
    await markSetupComplete(ctx)

    const statePath = resolve(process.cwd(), ADMIN_STORAGE_STATE)
    mkdirSync(dirname(statePath), { recursive: true })
    writeFileSync(statePath, JSON.stringify(admin.storageState, null, 2))
    writeFileSync(
      resolve(process.cwd(), STATE_FILE),
      JSON.stringify({ adminUserId: admin.userId, defaultTeamId: team.id }, null, 2),
    )
  } finally {
    await ctx.dispose()
  }
}
