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

// Boot-time seed. After the startup-wizard cutover (design D1 / spec §8) this
// seeds ONLY the editLockedStates lifecycle setting — RBAC content (roles +
// teams) is created by the first-run setup wizard, not the boot path.
// `seedRoles` stays exported for test fixtures that exercise the policy engine.

import { GLOBAL_TEAM_ID, GLOBAL_TEAM_NAME } from '@/lib/global-team'
import { ROLE_SEEDS, EDIT_LOCKED_STATES_DEFAULT } from '../authz/rights'
import { rawQuery } from './db'

/** Insert the 16 canonical seeded roles + their rights (idempotent). NOT called
 *  on the boot path; production role creation flows through the wizard's
 *  role-templates endpoint. Used by test fixtures and any explicit re-seed. */
export async function seedRoles(): Promise<void> {
  for (const r of ROLE_SEEDS) {
    await rawQuery(
      `INSERT INTO "role" ("id","name","description","isSeeded") VALUES ($1,$2,$3,1) ON CONFLICT DO NOTHING`,
      [r.id, r.name, r.description],
    )
    for (const right of r.rights) {
      await rawQuery(`INSERT INTO "role_right" ("roleId","right") VALUES ($1,$2) ON CONFLICT DO NOTHING`, [r.id, right])
    }
  }
}

export async function seedRbac(): Promise<void> {
  await rawQuery(`INSERT INTO "app_setting" (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`, [
    'editLockedStates',
    JSON.stringify(EDIT_LOCKED_STATES_DEFAULT),
  ])
  await rawQuery(`INSERT INTO "app_setting" (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`, [
    'esignatureRoles',
    JSON.stringify([]),
  ])
}

/**
 * The GLOBAL team (spec 2026-10-12 §4.1): fixed id, idempotent, every boot. If a different
 * team already uses the name GLOBAL, create nothing and say so — the feature then behaves
 * as it did before until an admin renames that team and restarts.
 */
export async function seedGlobalTeam(): Promise<void> {
  const [byName] = await rawQuery<{ id: string }>('SELECT "id" FROM "team" WHERE "name" = $1', [GLOBAL_TEAM_NAME])
  if (byName && byName.id !== GLOBAL_TEAM_ID) {
    console.warn(
      `[seed] a team named "${GLOBAL_TEAM_NAME}" already exists (id ${byName.id}); GLOBAL shared libraries are disabled until it is renamed`,
    )
    return
  }
  const now = Date.now()
  await rawQuery(
    `INSERT INTO "team" ("id","name","description","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$4)
     ON CONFLICT ("id") DO NOTHING`,
    [GLOBAL_TEAM_ID, GLOBAL_TEAM_NAME, 'Libraries every team can use', now],
  )
}
