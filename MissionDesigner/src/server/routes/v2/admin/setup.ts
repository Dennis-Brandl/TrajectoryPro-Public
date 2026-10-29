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

// First-run completion (design §5.3). Admin-only. Re-validates the two invariants
// (>=1 admin AND >=1 team) server-side before flipping setupComplete, so the
// client can never mark setup done without the data existing. Admin gate: ./index.ts.

import { GLOBAL_TEAM_ID } from '@/lib/global-team'
import { Hono } from 'hono'
import { rawQuery } from '../../../lib/db'
import { v2ErrorBody } from '../../../errors/v2'
import { hasAdmin, markSetupComplete } from '../../../lib/setupState'
import type { V2Session } from '../../../middleware/v2/permissions'

type Variables = { v2Session: V2Session }

export const adminSetupV2 = new Hono<{ Variables: Variables }>()

// I2: COUNT(*) returns bigint → string from rawQuery; Number() wraps it.
adminSetupV2.post('/admin/setup-complete', async (c) => {
  const adminExists = await hasAdmin()
  // GLOBAL is seeded at boot, so it never counts as "the install has a team".
  const rows = await rawQuery<{ n: string }>('SELECT COUNT(*) AS n FROM "team" WHERE "id" <> $1', [GLOBAL_TEAM_ID])
  const teamCount = Number(rows[0]?.n ?? 0)
  if (!adminExists || teamCount < 1) {
    return c.json(v2ErrorBody('setup_incomplete', { hasAdmin: adminExists, teamCount }), 409)
  }
  await markSetupComplete()
  return c.json({ setupComplete: true })
})
