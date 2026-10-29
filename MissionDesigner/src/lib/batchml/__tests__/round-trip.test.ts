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

import { describe, it, expect } from 'vitest'
import { exportBatchml } from '../batchml-exporter'
import { importBatchml } from '../batchml-importer'
import type { MasterWorkflowSpecification, MasterWorkflowStep } from '@/lib/packageFormat/export-types'

function st(
  oid: string,
  step_type: MasterWorkflowStep['step_type'],
  extra: Partial<MasterWorkflowStep> = {},
): MasterWorkflowStep {
  return { oid, local_id: oid, version: '1.0.0', last_modified_date: '2026-01-01T00:00:00Z', step_type, ...extra }
}

const corpus: Record<string, MasterWorkflowSpecification> = {
  minimal: {
    oid: 'm',
    local_id: 'Minimal',
    version: '1.0.0',
    last_modified_date: '2026-01-01T00:00:00Z',
    steps: [st('s', 'START'), st('e', 'END')],
    connections: [{ from_step_id: 's', to_step_id: 'e' }],
  },
  branching: {
    oid: 'b',
    local_id: 'Branching',
    version: '1.0.0',
    last_modified_date: '2026-01-01T00:00:00Z',
    schemaVersion: '4.0',
    display_style: 'isa88',
    steps: [
      st('s', 'START'),
      st('sel', 'SELECT 1', {
        select1_config: {
          input_name: 'grade',
          input_value_type: 'literal',
          options: [
            { id: 'o1', label: 'A', operator: '==', value: 'A', value_type: 'literal', is_default: false },
            { id: 'o2', label: 'else', operator: '==', value: '', value_type: 'literal', is_default: true },
          ],
        },
      }),
      st('a', 'ACTION PROXY', { action_proxy_config: { action_oid: 'act1', environment_oid: 'env1' } }),
      st('w', 'WAIT ANY'),
      st('e', 'END'),
    ],
    connections: [
      { from_step_id: 's', to_step_id: 'sel' },
      { from_step_id: 'sel', to_step_id: 'a', source_handle_id: 'o1' },
      { from_step_id: 'sel', to_step_id: 'w', source_handle_id: 'o2' },
      { from_step_id: 'a', to_step_id: 'w' },
      { from_step_id: 'w', to_step_id: 'e' },
    ],
  },
  exceptionModel: {
    oid: 'x',
    local_id: 'Exception',
    version: '1.0.0',
    last_modified_date: '2026-01-01T00:00:00Z',
    steps: [
      st('s', 'START'),
      st('a', 'ACTION PROXY', {
        action_proxy_config: { action_oid: 'act1', environment_oid: 'env1' },
        try_specifications: [{ mode: 'ERROR', catch_id: 'c1', release_on_catch: true }],
      }),
      st('c', 'CATCH', { catch_id: 'c1' }),
      st('r', 'RETURN', { return_config: { command: 'RESTART', restart_mode: 'CLEAN' } }),
      st('e', 'END'),
    ],
    connections: [
      { from_step_id: 's', to_step_id: 'a' },
      { from_step_id: 'a', to_step_id: 'e' },
      { from_step_id: 'c', to_step_id: 'r' },
    ],
  },
  richContent: {
    oid: 'rc',
    local_id: 'Rich',
    version: '1.0.0',
    last_modified_date: '2026-01-01T00:00:00Z',
    steps: [
      st('u', 'USER_INTERACTION', {
        form_layout_config: [
          {
            deviceType: 'desktop',
            canvasWidth: 800,
            canvasHeight: 600,
            elements: [{ type: 'button', label: 'Go — 温度 & "q"' }],
          },
        ],
      }),
      st('sc', 'SCRIPT', { script_config: { language: 'typescript', source: 'output.x = inputs.y * 2' } }),
    ],
    connections: [{ from_step_id: 'u', to_step_id: 'sc' }],
    starting_parameter_specifications: [{ id: 'Temp', default_value: '98.6', json_schema: '{"type":"number"}' }],
    value_property_specifications: [{ name: 'Prop', entries: [{ name: 'Value', value: 'v' }] }],
  },
  resources: {
    oid: 'r',
    local_id: 'Resources',
    version: '1.0.0',
    last_modified_date: '2026-01-01T00:00:00Z',
    steps: [
      st('s', 'START'),
      st('a', 'ACTION PROXY', {
        action_proxy_config: { action_oid: 'act1', environment_oid: 'env1' },
        resource_command_specifications: [
          {
            oid: 'rc1',
            command_type: 'Acquire',
            resource_name: 'Mixer',
            resource_source_type: 'environment',
            resource_source_oid: 'env1',
            amount: 1,
            target: 'unitA',
          },
        ],
      }),
      st('e', 'END'),
    ],
    connections: [
      { from_step_id: 's', to_step_id: 'a' },
      { from_step_id: 'a', to_step_id: 'e' },
    ],
    resource_command_specifications: [
      {
        oid: 'rc0',
        command_type: 'Release',
        resource_name: 'Mixer',
        resource_source_type: 'workflow',
        source: 'unitA',
      },
    ],
    resource_property_specifications: [
      {
        name: 'Mixer',
        resource_type: 'countable use with pool limits',
        scope: 'workflow',
        use_limit: 2,
        description: 'Shared mixer unit',
        names: ['Mixer'],
      },
    ],
  },
  nestedChildren: {
    oid: 'nc',
    local_id: 'Nested',
    version: '1.0.0',
    last_modified_date: '2026-01-01T00:00:00Z',
    steps: [st('p', 'WORKFLOW PROXY')],
    connections: [],
    children: [
      {
        oid: 'child1',
        local_id: 'Child',
        version: '1.0.0',
        last_modified_date: '2026-01-01T00:00:00Z',
        parentChildSpecId: null,
        state: 'Draft',
        steps: [st('cs', 'START'), st('ce', 'END')],
        connections: [{ from_step_id: 'cs', to_step_id: 'ce' }],
      },
    ],
  },
}

describe('BatchML trajectory round-trip (corpus)', () => {
  for (const [name, spec] of Object.entries(corpus)) {
    it(`round-trips "${name}" losslessly`, () => {
      const xml = exportBatchml(spec)
      expect(importBatchml(xml)).toEqual(spec)
    })
  }
})
