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
 * instance-manager-property-rekey.test.ts — set_property writes from a state
 * execution that was already running when an environment (or action) re-key
 * committed must not be dropped.
 *
 * The StateMachine hands applyPropertyMutations() the environment oid it
 * loaded from the instance row at transition time. An import that re-keys the
 * environment deletes that oid inside its transaction; the instance row itself
 * is re-pointed at the new oid. So when the given oid no longer exists, the
 * write must be resolved through the instance's CURRENT row instead of being
 * silently skipped.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  ActionRepository,
  EnvironmentRepository,
  InstanceRepository,
  type EnvironmentInput,
} from '@mission/autopilot-storage'
import { createTestDb } from '@mission/autopilot-storage/testing'
import { InstanceManager } from '../instance-manager/instance-manager.js'

function envInput(oid: string, mode: string): EnvironmentInput {
  return {
    oid,
    local_id: 'Kitchen',
    version: '1.0',
    last_modified_date: '2026-09-02T00:00:00.000Z',
    description: null,
    schema_version: '4.0',
    action_property_specifications: [{ name: 'SIM', entries: [{ name: 'Mode', value: mode }] }],
    value_property_specifications: [],
    resource_property_specifications: [],
    source_filename: 'Kitchen.WFenvir',
  }
}

type PrivateApply = {
  applyPropertyMutations: (
    environment_oid: string,
    source_action_oid: string,
    source_instance_id: string,
    mutations: Array<{ spec_name: string; entry_name: string; value: string }>
  ) => Promise<void>
}

describe('applyPropertyMutations across an environment re-key', () => {
  it('resolves a vanished environment oid through the instance row and writes to the new environment', async () => {
    const db = await createTestDb()
    const envRepo = new EnvironmentRepository(db)
    const actionRepo = new ActionRepository(db)
    const instanceRepo = new InstanceRepository(db)
    const publishProperty = vi.fn()
    const manager = new InstanceManager(db, {
      scriptPath: 'unused-for-this-test',
      poolSize: 0,
      sseManager: { publishProperty },
    })

    try {
      await envRepo.create(envInput('e1', 'slow'))
      await actionRepo.create({
        oid: 'a1',
        environment_oid: 'e1',
        local_id: 'Mix',
        version: '1.0',
        last_modified_date: '2026-09-02T00:00:00.000Z',
        action_visibility: 'opaque',
        input_parameter_specifications: [],
        output_parameter_specifications: [],
        property_specifications: [],
      })
      const instance = await instanceRepo.create({
        runtime_action_instance_id: 'replaced',
        action_oid: 'a1',
        environment_oid: 'e1',
        workflow_instance_id: 'wf-1',
        step_instance_id: 'step-inst-1',
        step_oid: 'step-1',
        visibility: 'opaque',
        state: 'IN_PROGRESS',
        input_parameters: [],
        output_parameters: [],
        state_history: [],
        pinned_code_versions: [],
        states_with_code_executed: [],
      })

      // The import's environment re-key, as it lands in storage.
      await envRepo.create(envInput('e2', 'slow'))
      await actionRepo.reassignEnvironment('e1', 'e2')
      await instanceRepo.reassignEnvironment('e1', 'e2')
      await envRepo.delete('e1')

      // The state execution that started before the re-key still carries e1.
      await (manager as unknown as PrivateApply).applyPropertyMutations(
        'e1',
        'a1',
        instance.runtime_action_instance_id,
        [{ spec_name: 'SIM', entry_name: 'Mode', value: 'fast' }]
      )

      const e2 = (await envRepo.findByOid('e2'))!
      const specs = e2.action_property_specifications as Array<{
        name: string
        entries: Array<{ name: string; value: string }>
      }>
      expect(specs[0]?.entries.find((e) => e.name === 'Mode')?.value).toBe('fast')
      expect(publishProperty).toHaveBeenCalledWith(
        'e2',
        'SIM',
        expect.objectContaining({ changed_entries: ['Mode'], source: 'action_code' })
      )
    } finally {
      await manager.shutdown()
      await db.close()
    }
  }, 30000)

  it('still drops the write when neither the oid nor the instance can be resolved', async () => {
    const db = await createTestDb()
    const publishProperty = vi.fn()
    const manager = new InstanceManager(db, {
      scriptPath: 'unused-for-this-test',
      poolSize: 0,
      sseManager: { publishProperty },
    })
    try {
      await expect(
        (manager as unknown as PrivateApply).applyPropertyMutations(
          'gone',
          'a1',
          'no-such-instance',
          [{ spec_name: 'SIM', entry_name: 'Mode', value: 'fast' }]
        )
      ).resolves.toBeUndefined()
      expect(publishProperty).not.toHaveBeenCalled()
    } finally {
      await manager.shutdown()
      await db.close()
    }
  }, 30000)
})
