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

// @vitest-environment node

/**
 * Unit test for importLibrariesFromZip — verifies that auto-created env/action
 * sibling libraries inherit the `teamId` and `createdByUserId` from the call args.
 *
 * Phase 2a regression guard: before the fix, insertLibrary omitted teamId and
 * createdByUserId, leaving them NULL → invisible to every non-admin caller under
 * the Phase 2a canSee rule (lib.teamId ∈ caller's team memberships).
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { bootstrapDatabase, rawQuery, withTransaction } from '../../lib/db'
import type { importLibrariesFromZip as importLibrariesFromZipT } from '../importLibrariesFromZip'

// ── Minimal valid environment-library JSON ───────────────────────────────────
// Built from reading importEnvironmentLibrary + validateEnvironmentLibrary:
//   - managed-element required fields: local_id, oid, version, last_modified_date
//   - environment_library required fields: environment_specifications[]
//   - each env spec: managed-element fields + included_actions[]
//   - each included_action: action_name, action_library (both required)
const MINIMAL_ENV_LIB_JSON = JSON.stringify({
  local_id: 'TestEnv',
  oid: 'oid-test-env-lib',
  version: '1.0.0',
  last_modified_date: '2026-01-01T00:00:00.000Z',
  environment_specifications: [
    {
      local_id: 'TestEnvSpec',
      oid: 'oid-test-env-spec',
      version: '1.0.0',
      last_modified_date: '2026-01-01T00:00:00.000Z',
      included_actions: [],
    },
  ],
})

// ── Minimal valid action-library JSON ────────────────────────────────────────
// Built from reading importActionLibrary + master-action-library.json schema:
//   - managed-element required fields: local_id, oid, version, last_modified_date
//   - action_library required fields: action_specifications[]
//   - each action spec: managed-element fields (input/output/property arrays optional)
const MINIMAL_ACTION_LIB_JSON = JSON.stringify({
  local_id: 'TestAction',
  oid: 'oid-test-action-lib',
  version: '1.0.0',
  last_modified_date: '2026-01-01T00:00:00.000Z',
  action_specifications: [
    {
      local_id: 'TestActionSpec',
      oid: 'oid-test-action-spec',
      version: '1.0.0',
      last_modified_date: '2026-01-01T00:00:00.000Z',
      input_parameter_specifications: [],
      output_parameter_specifications: [],
      property_specifications: [],
    },
  ],
})

const TEAM_ID = 'team-x'
const USER_ID = 'u1'

let importLibrariesFromZip: typeof importLibrariesFromZipT

beforeAll(async () => {
  await bootstrapDatabase()
  ;({ importLibrariesFromZip } = await import('../importLibrariesFromZip'))
})

beforeEach(async () => {
  // Truncate content tables; roles stay intact from bootstrapDatabase/seedRbac.
  await rawQuery(`TRUNCATE specification, library CASCADE`)
  await rawQuery(`TRUNCATE "user_team_role", "user_team", "user", team CASCADE`)

  const NOW = Date.now()
  await rawQuery(`INSERT INTO team (id, name, description, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5)`, [
    TEAM_ID,
    'Team X',
    null,
    NOW,
    NOW,
  ])
  await rawQuery(`INSERT INTO "user" (id, email, "isAdministrator") VALUES ($1, $2, $3)`, [
    USER_ID,
    'u1@example.com',
    false,
  ])
})

describe('importLibrariesFromZip — team propagation', () => {
  it('creates env library with teamId and createdByUserId from args', async () => {
    const result = await withTransaction(async (q) =>
      importLibrariesFromZip(
        {
          userId: USER_ID,
          teamId: TEAM_ID,
          envLibraryJsons: [{ name: 'TestEnv', jsonText: MINIMAL_ENV_LIB_JSON }],
          actionLibraryJsons: [],
        },
        q,
      ),
    )

    // Functional: one env library created, none reused.
    expect(result.envLibrariesCreated).toBe(1)
    expect(result.envLibrariesReused).toBe(0)
    expect(result.envLibraryIdsByName.has('TestEnv')).toBe(true)

    // Correctness: the DB row must carry teamId = TEAM_ID and createdByUserId = USER_ID.
    const libId = result.envLibraryIdsByName.get('TestEnv')!
    const [row] = await rawQuery<{ teamId: string | null; createdByUserId: string | null }>(
      `SELECT "teamId", "createdByUserId" FROM library WHERE id = $1`,
      [libId],
    )
    expect(row).toBeDefined()
    expect(row!.teamId).toBe(TEAM_ID)
    expect(row!.createdByUserId).toBe(USER_ID)
  })

  it('reuses existing env library by teamId (not userId) on re-import', async () => {
    // Insert a pre-existing env library belonging to TEAM_ID.
    const NOW = Date.now()
    await rawQuery(
      `INSERT INTO library (id, "teamId", "createdByUserId", name, "entityType", version, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'environment', '1.0.0', $5, $6)`,
      ['lib-pre-existing', TEAM_ID, USER_ID, 'PreExistingEnv', NOW, NOW],
    )

    const result = await withTransaction(async (q) =>
      importLibrariesFromZip(
        {
          userId: USER_ID,
          teamId: TEAM_ID,
          envLibraryJsons: [
            {
              name: 'PreExistingEnv',
              jsonText: JSON.stringify({
                local_id: 'PreExistingEnv',
                oid: 'oid-pre-existing',
                version: '1.0.0',
                last_modified_date: '2026-01-01T00:00:00.000Z',
                environment_specifications: [],
              }),
            },
          ],
          actionLibraryJsons: [],
        },
        q,
      ),
    )

    // Must reuse, not create a new row.
    expect(result.envLibrariesReused).toBe(1)
    expect(result.envLibrariesCreated).toBe(0)
    expect(result.envLibraryIdsByName.get('PreExistingEnv')).toBe('lib-pre-existing')
  })

  it('creates action library with teamId and createdByUserId from args', async () => {
    const result = await withTransaction(async (q) =>
      importLibrariesFromZip(
        {
          userId: USER_ID,
          teamId: TEAM_ID,
          envLibraryJsons: [],
          actionLibraryJsons: [{ name: 'TestAction', jsonText: MINIMAL_ACTION_LIB_JSON }],
        },
        q,
      ),
    )

    // Functional: one action library created, none reused.
    expect(result.actionLibrariesCreated).toBe(1)
    expect(result.actionLibrariesReused).toBe(0)
    expect(result.actionLibraryIdsByName.has('TestAction')).toBe(true)

    // Correctness: the DB row must carry teamId = TEAM_ID and createdByUserId = USER_ID.
    const libId = result.actionLibraryIdsByName.get('TestAction')!
    const [row] = await rawQuery<{ teamId: string | null; createdByUserId: string | null }>(
      `SELECT "teamId", "createdByUserId" FROM library WHERE id = $1`,
      [libId],
    )
    expect(row).toBeDefined()
    expect(row!.teamId).toBe(TEAM_ID)
    expect(row!.createdByUserId).toBe(USER_ID)
  })
})

describe('importLibrariesFromZip — warnings for skipped siblings (audit item 3)', () => {
  it('reports a warning instead of silently skipping a malformed sibling JSON', async () => {
    const result = await withTransaction(async (q) =>
      importLibrariesFromZip(
        {
          userId: USER_ID,
          teamId: TEAM_ID,
          envLibraryJsons: [{ name: 'BrokenEnv', jsonText: 'not json at all {' }],
          actionLibraryJsons: [{ name: 'BrokenAction', jsonText: '{{nope' }],
        },
        q,
      ),
    )
    expect(result.envLibrariesCreated).toBe(0)
    expect(result.actionLibrariesCreated).toBe(0)
    expect(result.warnings.some((w) => w.includes('BrokenEnv'))).toBe(true)
    expect(result.warnings.some((w) => w.includes('BrokenAction'))).toBe(true)
  })

  it('reports a warning when a sibling fails importer validation', async () => {
    const result = await withTransaction(async (q) =>
      importLibrariesFromZip(
        {
          userId: USER_ID,
          teamId: TEAM_ID,
          // Valid JSON but not a valid environment library shape.
          envLibraryJsons: [{ name: 'ShapelessEnv', jsonText: '{"hello":"world"}' }],
          actionLibraryJsons: [],
        },
        q,
      ),
    )
    expect(result.envLibrariesCreated).toBe(0)
    expect(result.warnings.some((w) => w.includes('ShapelessEnv'))).toBe(true)
  })

  it('yields no warnings on a clean import', async () => {
    const result = await withTransaction(async (q) =>
      importLibrariesFromZip(
        {
          userId: USER_ID,
          teamId: TEAM_ID,
          envLibraryJsons: [{ name: 'TestEnv', jsonText: MINIMAL_ENV_LIB_JSON }],
          actionLibraryJsons: [{ name: 'TestAction', jsonText: MINIMAL_ACTION_LIB_JSON }],
        },
        q,
      ),
    )
    expect(result.warnings).toEqual([])
  })
})

describe('importLibrariesFromZip — GLOBAL reuse (spec 2026-10-12 §4.6)', () => {
  async function insertLib(id: string, teamId: string, name: string, entityType: 'action' | 'environment') {
    const now = Date.now()
    await rawQuery(
      `INSERT INTO library (id, "teamId", "createdByUserId", name, "entityType", version, "createdAt", "updatedAt")
       VALUES ($1, $2, NULL, $3, $4, '1.0.0', $5, $5)`,
      [id, teamId, name, entityType, now],
    )
  }
  async function insertGlobalTeam() {
    const now = Date.now()
    await rawQuery(
      `INSERT INTO team (id, name, description, "createdAt", "updatedAt") VALUES ('team-global','GLOBAL',NULL,$1,$1) ON CONFLICT DO NOTHING`,
      [now],
    )
  }

  it('reuses a GLOBAL action library, writes nothing into it, and says so', async () => {
    await insertGlobalTeam()
    await insertLib('lib-g', 'team-global', 'TestAction', 'action')

    const result = await withTransaction(async (q) =>
      importLibrariesFromZip(
        {
          userId: USER_ID,
          teamId: TEAM_ID,
          envLibraryJsons: [],
          actionLibraryJsons: [{ name: 'TestAction', jsonText: MINIMAL_ACTION_LIB_JSON }],
        },
        q,
      ),
    )

    expect(result.actionLibraryIdsByName.get('TestAction')).toBe('lib-g')
    expect(result.actionLibrariesCreated).toBe(0)
    expect(result.warnings).toContain('Action library "TestAction" linked to the GLOBAL library')
    const specs = await rawQuery(`SELECT 1 FROM specification WHERE "libraryId" = 'lib-g'`)
    expect(specs).toHaveLength(0)
    const copies = await rawQuery(`SELECT 1 FROM library WHERE "teamId" = $1`, [TEAM_ID])
    expect(copies).toHaveLength(0)
  })

  it('the target team library wins over the GLOBAL one (U4)', async () => {
    await insertGlobalTeam()
    await insertLib('lib-g', 'team-global', 'TestEnv', 'environment')
    await insertLib('lib-t', TEAM_ID, 'TestEnv', 'environment')

    const result = await withTransaction(async (q) =>
      importLibrariesFromZip(
        {
          userId: USER_ID,
          teamId: TEAM_ID,
          envLibraryJsons: [{ name: 'TestEnv', jsonText: MINIMAL_ENV_LIB_JSON }],
          actionLibraryJsons: [],
        },
        q,
      ),
    )

    expect(result.envLibraryIdsByName.get('TestEnv')).toBe('lib-t')
    expect(result.warnings).toEqual([])
  })

  it("another team's library is still never reused", async () => {
    const now = Date.now()
    await rawQuery(
      `INSERT INTO team (id, name, description, "createdAt", "updatedAt") VALUES ('team-y','Team Y',NULL,$1,$1)`,
      [now],
    )
    await insertLib('lib-y', 'team-y', 'TestAction', 'action')

    const result = await withTransaction(async (q) =>
      importLibrariesFromZip(
        {
          userId: USER_ID,
          teamId: TEAM_ID,
          envLibraryJsons: [],
          actionLibraryJsons: [{ name: 'TestAction', jsonText: MINIMAL_ACTION_LIB_JSON }],
        },
        q,
      ),
    )

    expect(result.actionLibraryIdsByName.get('TestAction')).not.toBe('lib-y')
    expect(result.actionLibrariesCreated).toBe(1)
  })
})
