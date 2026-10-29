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

/** The library schema caps a GATE's cycle_seconds at 52 weeks, the same cap the engine and the
 *  Script step's repeat cycle use (MAX_DELAY_SECONDS). */

import { describe, it, expect } from 'vitest'
import { validateWorkflowLibrary } from '@/lib/import/schema-validator'
import { MAX_DELAY_SECONDS } from '@/lib/duration'

const BASE = { version: '1.0.0', last_modified_date: '2026-06-01T00:00:00Z' }

function libraryWithGateCycle(cycleSeconds: number): Record<string, unknown> {
  return {
    local_id: 'Gate Lib',
    oid: 'lib-gate-cycle',
    ...BASE,
    workflow_specifications: [
      {
        schemaVersion: '5.0',
        local_id: 'Gate Workflow',
        oid: 'wf-gate-cycle',
        ...BASE,
        steps: [
          {
            local_id: 'Gate',
            oid: 'step-gate',
            ...BASE,
            step_type: 'GATE',
            position: { x: 0, y: 0 },
            gate_config: { cycle_seconds: cycleSeconds, source: 'return true;' },
          },
        ],
        connections: [],
      },
    ],
  }
}

describe('GATE cycle_seconds in the workflow-library schema', () => {
  it('accepts 52 weeks', () => {
    expect(validateWorkflowLibrary(libraryWithGateCycle(MAX_DELAY_SECONDS)).success).toBe(true)
  })

  it('rejects one second more than 52 weeks', () => {
    expect(validateWorkflowLibrary(libraryWithGateCycle(MAX_DELAY_SECONDS + 1)).success).toBe(false)
  })
})
