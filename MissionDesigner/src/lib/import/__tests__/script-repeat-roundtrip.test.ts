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
import { exportWorkflow } from '@/lib/packageFormat/workflow-exporters'
import { importWorkflow } from '../workflow-importers'
import type { WorkflowNode } from '@/types/nodes'
import type { Specification } from '@/types/library'

const NOW = Date.now()

function roundTrip(data: Record<string, unknown>) {
  const node = {
    id: 'sc-1',
    type: 'scriptStep',
    position: { x: 0, y: 0 },
    data: { label: 'Poll', stepType: 'scriptStep', ...data },
  } as unknown as WorkflowNode
  const spec: Specification = {
    id: 'wf-1',
    libraryId: 'lib-1',
    name: 'Poll Flow',
    description: null,
    version: '1.0.0',
    state: 'Draft',
    data: { nodes: [node], edges: [] },
    history: [],
    createdAt: NOW,
    updatedAt: NOW,
  }
  const exported = exportWorkflow(spec, [node], [], undefined, [spec])
  const step = exported.steps.find((s) => s.local_id === 'Poll')
  const result = importWorkflow(exported)
  if ('error' in result) throw new Error(String(result.error))
  return { step, data: result.nodes.find((n) => n.id === 'sc-1')!.data }
}

describe('repeating SCRIPT export → import round-trip', () => {
  it('keeps the repeat settings; the time limit comes back as boxes', () => {
    const { step, data } = roundTrip({
      scriptSource: 'return false;',
      scriptLanguage: 'javascript',
      scriptRepeat: true,
      scriptCycleSeconds: 3,
      scriptTimeLimit: { hours: 1, minutes: 30 },
      scriptOnTimeLimit: 'complete',
    })
    expect(step?.script_config).toEqual({
      language: 'javascript',
      source: 'return false;',
      repeat: { cycle_seconds: 3, time_limit_seconds: 5400, on_time_limit: 'complete' },
    })
    expect(data.scriptRepeat).toBe(true)
    expect(data.scriptCycleSeconds).toBe(3)
    expect(data.scriptTimeLimit).toEqual({ weeks: 0, days: 0, hours: 1, minutes: 30, seconds: 0 })
    expect(data.scriptOnTimeLimit).toBe('complete')
  })
  it('a one-shot script imports with no repeat fields', () => {
    const { data } = roundTrip({ scriptSource: 'return true;' })
    expect(data.scriptRepeat).toBeUndefined()
    expect(data.scriptTimeLimit).toBeUndefined()
  })
})
