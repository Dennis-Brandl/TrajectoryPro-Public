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

/**
 * instance-manager-property-edit.test.ts — InstanceManager.setPropertyValues()
 *
 * The console's management API edits environment-level Action Property values
 * through this public method rather than writing to the repository directly,
 * so console saves share the same serialized chain as runtime `set_property`
 * writes (see instance-manager-property-race.test.ts for the chain proof).
 *
 * Unlike the lenient runtime path (unknown property skipped, unknown entry
 * appended), the console path is strict: every edit must name an existing
 * property AND an existing entry, and an invalid batch writes nothing.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { EnvironmentRepository } from '@mission/autopilot-storage'
import { createTestDb, type TestDb } from '@mission/autopilot-storage/testing'
import { InstanceManager } from '../instance-manager/instance-manager.js'
import { PropertyEditError, type PropertySsePublisher } from '../instance-manager/types.js'

let db: TestDb
let envRepo: EnvironmentRepository

beforeAll(async () => {
  db = await createTestDb()
  envRepo = new EnvironmentRepository(db)
})

afterAll(async () => {
  await db.close()
})

async function seedEnv(): Promise<string> {
  const envOid = `env-edit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  await envRepo.create({
    oid: envOid,
    local_id: 'edit-test-env',
    version: '1.0',
    last_modified_date: new Date().toISOString(),
    schema_version: '1',
    action_property_specifications: [
      {
        name: 'Config',
        oid: 'prop-config',
        description: 'Connection settings',
        entries: [
          { name: 'Host', value: 'localhost', oid: 'entry-host' },
          { name: 'Port', value: '8080', oid: 'entry-port' },
        ],
      },
      {
        name: 'Flags',
        entries: [{ name: 'Debug', value: 'false' }],
      },
    ],
    value_property_specifications: [],
    resource_property_specifications: [],
    source_filename: 'edit-test.json',
  })
  return envOid
}

function publishSpy() {
  return vi.fn<PropertySsePublisher['publishProperty']>()
}

function createManager(sseManager?: PropertySsePublisher) {
  // poolSize: 0 — no code executes in these tests, so no Python workers.
  return new InstanceManager(db, {
    scriptPath: 'unused-for-this-test',
    poolSize: 0,
    sseManager,
  })
}

async function readSpecs(envOid: string) {
  const env = (await envRepo.findByOid(envOid))!
  return env.action_property_specifications as Array<{
    name: string
    oid?: string
    description?: string
    entries: Array<{ name: string; value: string; oid?: string }>
  }>
}

describe('InstanceManager.setPropertyValues', () => {
  it('updates only the named entry values and preserves every other field', async () => {
    const envOid = await seedEnv()
    const manager = createManager()
    try {
      const result = await manager.setPropertyValues(envOid, [
        { spec_name: 'Config', entry_name: 'Host', value: '10.0.0.5' },
        { spec_name: 'Flags', entry_name: 'Debug', value: 'true' },
      ])

      const specs = await readSpecs(envOid)
      expect(specs).toEqual([
        {
          name: 'Config',
          oid: 'prop-config',
          description: 'Connection settings',
          entries: [
            { name: 'Host', value: '10.0.0.5', oid: 'entry-host' },
            { name: 'Port', value: '8080', oid: 'entry-port' },
          ],
        },
        { name: 'Flags', entries: [{ name: 'Debug', value: 'true' }] },
      ])
      // The method hands back the persisted specs so callers need not re-read.
      expect(result).toEqual(specs)
    } finally {
      await manager.shutdown()
    }
  })

  it('throws PROPERTY_NOT_FOUND and writes nothing when a property is unknown', async () => {
    const envOid = await seedEnv()
    const manager = createManager()
    try {
      await expect(
        manager.setPropertyValues(envOid, [
          { spec_name: 'Config', entry_name: 'Host', value: 'changed' },
          { spec_name: 'Missing', entry_name: 'X', value: '1' },
        ])
      ).rejects.toMatchObject({ code: 'PROPERTY_NOT_FOUND', details: { property: 'Missing' } })

      const specs = await readSpecs(envOid)
      expect(specs[0]!.entries[0]!.value).toBe('localhost')
    } finally {
      await manager.shutdown()
    }
  })

  it('throws ENTRY_NOT_FOUND and writes nothing when an entry is unknown', async () => {
    const envOid = await seedEnv()
    const manager = createManager()
    try {
      const err = await manager
        .setPropertyValues(envOid, [
          { spec_name: 'Config', entry_name: 'Host', value: 'changed' },
          { spec_name: 'Config', entry_name: 'Nope', value: '1' },
        ])
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(PropertyEditError)
      expect(err).toMatchObject({
        code: 'ENTRY_NOT_FOUND',
        details: { property: 'Config', entry: 'Nope' },
      })

      const specs = await readSpecs(envOid)
      expect(specs[0]!.entries[0]!.value).toBe('localhost')
      // Strict path never appends — the runtime path's append is not inherited.
      expect(specs[0]!.entries).toHaveLength(2)
    } finally {
      await manager.shutdown()
    }
  })

  it('throws ENVIRONMENT_NOT_FOUND for an unknown environment', async () => {
    const manager = createManager()
    try {
      await expect(
        manager.setPropertyValues('env-does-not-exist', [
          { spec_name: 'Config', entry_name: 'Host', value: 'x' },
        ])
      ).rejects.toMatchObject({ code: 'ENVIRONMENT_NOT_FOUND' })
    } finally {
      await manager.shutdown()
    }
  })

  it('publishes one SSE event per touched property with source "console"', async () => {
    const envOid = await seedEnv()
    const publishProperty = publishSpy()
    const manager = createManager({ publishProperty })
    try {
      await manager.setPropertyValues(envOid, [
        { spec_name: 'Config', entry_name: 'Host', value: 'a' },
        { spec_name: 'Config', entry_name: 'Port', value: '1' },
        { spec_name: 'Flags', entry_name: 'Debug', value: 'true' },
      ])

      expect(publishProperty).toHaveBeenCalledTimes(2)
      expect(publishProperty).toHaveBeenCalledWith(envOid, 'Config', {
        entries: [
          { name: 'Host', value: 'a', oid: 'entry-host' },
          { name: 'Port', value: '1', oid: 'entry-port' },
        ],
        changed_entries: ['Host', 'Port'],
        source: 'console',
      })
      expect(publishProperty).toHaveBeenCalledWith(envOid, 'Flags', {
        entries: [{ name: 'Debug', value: 'true' }],
        changed_entries: ['Debug'],
        source: 'console',
      })
    } finally {
      await manager.shutdown()
    }
  })

  it('publishes nothing when the batch is rejected', async () => {
    const envOid = await seedEnv()
    const publishProperty = publishSpy()
    const manager = createManager({ publishProperty })
    try {
      await manager
        .setPropertyValues(envOid, [{ spec_name: 'Config', entry_name: 'Nope', value: '1' }])
        .catch(() => undefined)
      expect(publishProperty).not.toHaveBeenCalled()
    } finally {
      await manager.shutdown()
    }
  })
})
