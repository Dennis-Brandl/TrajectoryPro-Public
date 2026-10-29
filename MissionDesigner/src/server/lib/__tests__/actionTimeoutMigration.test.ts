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

// Task 6: one-time boot pass clearing Designer-stamped 30 s ACTION PROXY timeouts.
import { beforeAll, describe, expect, it } from 'vitest'
import { rawQuery, bootstrapDatabase } from '../db'
import { clearStampedActionTimeouts, clearStampedTimeouts, ACTION_TIMEOUT_CLEAR_KEY } from '../actionTimeoutMigration'

const NOW = 1000

function node(id: string, timeout?: number): Record<string, unknown> {
  return {
    id,
    type: 'actionProxyWait',
    data: {
      actionProxyConfig: {
        action_oid: 'x',
        environment_oid: 'e',
        ...(timeout === undefined ? {} : { timeout_ms: timeout }),
      },
    },
  }
}
const spec = (...nodes: Array<Record<string, unknown>>): string => JSON.stringify({ nodes })

async function timeouts(id: string): Promise<Array<number | undefined>> {
  const [row] = await rawQuery<{ data: string }>('SELECT data FROM "specification" WHERE id = $1', [id])
  const parsed = JSON.parse(row.data) as { nodes: Array<{ data: { actionProxyConfig: { timeout_ms?: number } } }> }
  return parsed.nodes.map((n) => n.data.actionProxyConfig.timeout_ms)
}

describe('clearStampedTimeouts (pure)', () => {
  it('deletes only 30000 and counts', () => {
    const data = { nodes: [node('a', 30000), node('b', 45000), node('c'), { id: 'd', data: {} }] }
    expect(clearStampedTimeouts(data)).toBe(1)
    expect(
      data.nodes.map((n) => (n.data as { actionProxyConfig?: { timeout_ms?: number } }).actionProxyConfig?.timeout_ms),
    ).toEqual([undefined, 45000, undefined, undefined])
  })
})

describe('clearStampedActionTimeouts', () => {
  beforeAll(async () => {
    await bootstrapDatabase()
    await rawQuery(`INSERT INTO "team" (id, name, description, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5)`, [
      'team-migration',
      'Migration Test Team',
      '',
      NOW,
      NOW,
    ])
    await rawQuery(
      `INSERT INTO "library" (id, "teamId", name, "entityType", version, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ['lib-migration', 'team-migration', 'Migration Test Library', 'workflow', '1.0.0', NOW, NOW],
    )
    async function seedSpec(
      id: string,
      state: string,
      data: string,
      parent: string | null = null,
      root: string = id,
    ): Promise<void> {
      await rawQuery(
        `INSERT INTO "specification"
           (id, "libraryId", name, version, state, data,
            "rootSpecificationId", "parentSpecificationId", "dataSchemaVersion", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [id, 'lib-migration', id, '1.0.0', state, data, root, parent, 4, NOW, NOW],
      )
    }
    await seedSpec('SPEC_DRAFT', 'Draft', spec(node('a', 30000), node('b', 45000), node('c')))
    await seedSpec('SPEC_INTEST', 'InTest', spec(node('a', 30000)))
    await seedSpec('SPEC_INREVIEW', 'InReview', spec(node('a', 30000)))
    await seedSpec('SPEC_EFFECTIVE', 'Effective', spec(node('a', 30000)))
    await seedSpec('CHILD_OF_DRAFT', 'Effective', spec(node('a', 30000)), 'SPEC_DRAFT', 'SPEC_DRAFT')
    await seedSpec('SPEC_CORRUPT', 'Draft', '{not json')
    await seedSpec('SPEC_NULL', 'Draft', 'null')
    // bootstrapDatabase already ran the pass on the empty DB.
    await rawQuery('DELETE FROM "app_setting" WHERE key = $1', [ACTION_TIMEOUT_CLEAR_KEY])
  })

  async function marker(): Promise<number> {
    const r = await rawQuery('SELECT 1 FROM "app_setting" WHERE key = $1', [ACTION_TIMEOUT_CLEAR_KEY])
    return r.length
  }

  it("clears 30000 in Draft, In Test and In Review and in a Draft root's child; keeps 45000, Effective and updatedAt", async () => {
    const res = await clearStampedActionTimeouts()
    expect(res).toMatchObject({ skipped: false, unreadable: 2, failed: 0 })
    expect(await timeouts('SPEC_DRAFT')).toEqual([undefined, 45000, undefined])
    expect(await timeouts('SPEC_INTEST')).toEqual([undefined])
    expect(await timeouts('SPEC_INREVIEW')).toEqual([undefined])
    expect(await timeouts('CHILD_OF_DRAFT')).toEqual([undefined])
    expect(await timeouts('SPEC_EFFECTIVE')).toEqual([30000])
    const rows = await rawQuery<{ updatedAt: number }>('SELECT "updatedAt" FROM "specification"')
    expect(rows.every((r) => Number(r.updatedAt) === NOW)).toBe(true)
  })

  it('unreadable rows (bad JSON, non-object) are skipped and do not block the marker', async () => {
    expect(await marker()).toBe(1)
    const [row] = await rawQuery<{ value: string }>('SELECT value FROM "app_setting" WHERE key = $1', [
      ACTION_TIMEOUT_CLEAR_KEY,
    ])
    const value = JSON.parse(row.value) as { unreadable: number; unreadableIds: string[] }
    expect(value.unreadable).toBe(2)
    expect([...value.unreadableIds].sort()).toEqual(['SPEC_CORRUPT', 'SPEC_NULL'])
  })

  it('once the marker is written a deliberate 30000 survives', async () => {
    await rawQuery('UPDATE "specification" SET data = $1 WHERE id = $2', [spec(node('a', 30000)), 'SPEC_DRAFT'])
    const res = await clearStampedActionTimeouts()
    expect(res.skipped).toBe(true)
    expect(await timeouts('SPEC_DRAFT')).toEqual([30000])
  })

  it('a genuine UPDATE failure leaves the marker unwritten (retry next boot)', async () => {
    await rawQuery('DELETE FROM "app_setting" WHERE key = $1', [ACTION_TIMEOUT_CLEAR_KEY])
    await rawQuery(
      `CREATE OR REPLACE FUNCTION test_block_upd() RETURNS trigger AS $$
       BEGIN IF NEW.id = 'SPEC_DRAFT' THEN RAISE EXCEPTION 'blocked'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`,
    )
    await rawQuery(
      `CREATE TRIGGER test_block_upd_trg BEFORE UPDATE ON "specification" FOR EACH ROW EXECUTE FUNCTION test_block_upd()`,
    )
    try {
      const res = await clearStampedActionTimeouts()
      expect(res).toMatchObject({ skipped: false, failed: 1 })
      expect(await marker()).toBe(0)
    } finally {
      await rawQuery('DROP TRIGGER test_block_upd_trg ON "specification"')
      await rawQuery('DROP FUNCTION test_block_upd()')
    }
  })
})
