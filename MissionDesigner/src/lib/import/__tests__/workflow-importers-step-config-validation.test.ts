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

// Audit item 3: the step-config fields that used to be blind double-casts
// ((step as unknown as Record<string, unknown>).script_config as {...}) are now
// zod-parsed at the import boundary. A malformed config is DROPPED WITH A
// WARNING instead of flowing garbage (numeric script language, junk operators)
// into node data; a valid config imports exactly as before.

import { describe, it, expect } from 'vitest'
import { importWorkflow } from '@/lib/import/workflow-importers'
import type { WorkflowNode } from '@/types/nodes'

function specWithStep(step: Record<string, unknown>): Record<string, unknown> {
  return {
    schemaVersion: '4.0',
    local_id: 'Cfg Validation',
    oid: 'wf-oid',
    version: '1.0.0',
    state: 'Draft',
    description: null,
    last_modified_date: '2026-05-29T00:00:00Z',
    connections: [],
    value_property_specifications: [],
    environment_specifications: [],
    children: [],
    steps: [
      {
        local_id: 'S1',
        oid: 'step-1',
        version: '1.0.0',
        last_modified_date: '2026-05-29T00:00:00Z',
        position: { x: 100, y: 200 },
        ...step,
      },
    ],
  }
}

function importOk(spec: Record<string, unknown>) {
  const result = importWorkflow(spec)
  if ('error' in result) throw new Error(`unexpected import error: ${result.error}`)
  return result
}

describe('step-config zod boundary (audit item 3)', () => {
  it('imports a valid script_config exactly as before, with no warnings', () => {
    const result = importOk(
      specWithStep({ step_type: 'SCRIPT', script_config: { language: 'python', source: 'print(1)' } }),
    )
    const node = result.nodes[0] as WorkflowNode
    expect(node.data.scriptLanguage).toBe('python')
    expect(node.data.scriptSource).toBe('print(1)')
    expect(result.warnings ?? []).toEqual([])
  })

  it('drops a malformed script_config with a warning instead of importing garbage', () => {
    const result = importOk(
      specWithStep({ step_type: 'SCRIPT', script_config: { language: 42, source: ['not', 'a', 'string'] } }),
    )
    const node = result.nodes[0] as WorkflowNode
    expect(node.data.scriptLanguage).toBeUndefined()
    expect(node.data.scriptSource).toBeUndefined()
    expect((result.warnings ?? []).some((w) => w.includes('step-1') && w.includes('script_config'))).toBe(true)
  })

  it('drops a malformed select1_config (bad option value_type) with a warning', () => {
    const result = importOk(
      specWithStep({
        step_type: 'SELECT 1',
        select1_config: {
          input_name: 'x',
          input_value_type: 'literal',
          options: [{ id: 'o1', label: 'A', operator: '=', value: '1', value_type: 'banana', is_default: true }],
        },
      }),
    )
    const node = result.nodes[0] as WorkflowNode
    expect(node.data.select1Options).toBeUndefined()
    expect((result.warnings ?? []).some((w) => w.includes('select1_config'))).toBe(true)
  })

  it('warns on an out-of-enum action_visibility instead of passing it through', () => {
    const result = importOk(
      specWithStep({
        step_type: 'ACTION PROXY',
        action_visibility: 'invisible',
        action_proxy_config: { action_oid: 'a1', environment_oid: 'e1' },
      }),
    )
    const node = result.nodes[0] as WorkflowNode
    expect(node.data.actionVisibility).toBeUndefined()
    expect((result.warnings ?? []).some((w) => w.includes('action_visibility'))).toBe(true)
  })

  it('warns when an ACTION PROXY step carries an invalid action_proxy_config', () => {
    const result = importOk(
      specWithStep({
        step_type: 'ACTION PROXY',
        action_proxy_config: { action_oid: 123, environment_oid: null },
      }),
    )
    const node = result.nodes[0] as WorkflowNode
    expect(node.data.actionProxyConfig).toBeUndefined()
    expect((result.warnings ?? []).some((w) => w.includes('action_proxy_config'))).toBe(true)
  })
})
