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

// Phase 4a: edit-lock configuration (design D12). The engine reads
// app_setting['editLockedStates'] fresh per check, so a PUT takes effect on
// the next request with no restart. Admin gate applied by ./index.ts.

import { Hono } from 'hono'
import { z } from 'zod'
import { rawQuery } from '../../../lib/db'
import { v2ErrorBody } from '../../../errors/v2'
import { editLockedStates, esignatureRoles } from '../../../authz/policy'
import type { SpecificationState } from '../../../../types/library'
import type { V2Session } from '../../../middleware/v2/permissions'

type Variables = { v2Session: V2Session }

export const adminSettingsV2 = new Hono<{ Variables: Variables }>()

const SPECIFICATION_STATES: readonly SpecificationState[] = [
  'Draft',
  'InTest',
  'InReview',
  'Approved',
  'Effective',
  'Superseded',
  'Obsolete',
] as const

const StatesBody = z.strictObject({
  states: z.array(z.enum([...SPECIFICATION_STATES] as [SpecificationState, ...SpecificationState[]])),
})

/** Canonical order = lifecycle order — stable for the UI and for comparisons. */
function canonical(states: Iterable<string>): SpecificationState[] {
  const set = new Set(states)
  return SPECIFICATION_STATES.filter((s) => set.has(s))
}

adminSettingsV2.get('/admin/settings/edit-locked-states', async (c) => {
  return c.json({ states: canonical(await editLockedStates()) })
})

adminSettingsV2.put('/admin/settings/edit-locked-states', async (c) => {
  let body: z.infer<typeof StatesBody>
  try {
    body = StatesBody.parse(await c.req.json())
  } catch {
    return c.json(v2ErrorBody('schema_mismatch', { field: 'states' }), 422)
  }
  const states = canonical(body.states)
  await rawQuery(
    `INSERT INTO "app_setting" (key, value) VALUES ('editLockedStates', $1)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [JSON.stringify(states)],
  )
  return c.json({ states })
})

const RolesBody = z.strictObject({ roles: z.array(z.string()) })

/** Trim every name; reject blank, over-long (> 64), case-insensitive duplicates, or > 200 entries. */
function normaliseRoles(input: string[]): string[] | null {
  if (input.length > 200) return null
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of input) {
    const name = raw.trim()
    if (!name || name.length > 64) return null
    const key = name.toLowerCase()
    if (seen.has(key)) return null
    seen.add(key)
    out.push(name)
  }
  return out
}

adminSettingsV2.get('/admin/settings/esignature-roles', async (c) => {
  return c.json({ roles: await esignatureRoles() })
})

adminSettingsV2.put('/admin/settings/esignature-roles', async (c) => {
  let body: z.infer<typeof RolesBody>
  try {
    body = RolesBody.parse(await c.req.json())
  } catch {
    return c.json(v2ErrorBody('schema_mismatch', { field: 'roles' }), 422)
  }
  const roles = normaliseRoles(body.roles)
  if (roles === null) return c.json(v2ErrorBody('schema_mismatch', { field: 'roles' }), 422)
  await rawQuery(
    `INSERT INTO "app_setting" (key, value) VALUES ('esignatureRoles', $1)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [JSON.stringify(roles)],
  )
  return c.json({ roles })
})
