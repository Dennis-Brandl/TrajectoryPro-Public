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
 * Regression coverage for CATCH/RETURN step acceptance in the AJV workflow-library schema.
 *
 * Before the fix, the step_type enum in master-workflow-library.json listed only the 11
 * legacy step types. Any workflow LIBRARY JSON containing a CATCH or RETURN step was
 * rejected by validateWorkflowLibrary with "step_type must be equal to one of the
 * allowed values". The importWorkflow fallback path (library extraction) therefore
 * also failed silently.
 */

import { describe, it, expect } from 'vitest'
import { validateWorkflowLibrary } from '@/lib/import/schema-validator'
import { importWorkflow } from '@/lib/import/workflow-importers'

// ---------------------------------------------------------------------------
// Minimal library envelope helpers
// ---------------------------------------------------------------------------

const BASE_DATE = '2026-06-01T00:00:00Z'

function managedElement(localId: string, oid: string) {
  return {
    local_id: localId,
    oid,
    version: '1.0.0',
    last_modified_date: BASE_DATE,
  }
}

function minimalStep(oid: string, localId: string, stepType: string, extra: Record<string, unknown> = {}) {
  return {
    ...managedElement(localId, oid),
    step_type: stepType,
    position: { x: 100, y: 100 },
    ...extra,
  }
}

/**
 * Minimal workflow-library JSON containing all three new-step-type variants:
 *  - an ACTION PROXY step with try_specifications
 *  - a CATCH step with catch_id
 *  - a RETURN step with return_config
 */
function makeLibraryWithTryCatchReturn(): Record<string, unknown> {
  return {
    ...managedElement('TryCatch Lib', 'lib-try-catch-001'),
    workflow_specifications: [
      {
        schemaVersion: '4.0',
        ...managedElement('TryCatch Workflow', 'wf-try-catch-001'),
        steps: [
          minimalStep('step-start-001', 'Start', 'START'),
          minimalStep('step-ap-001', 'Run Action', 'ACTION PROXY', {
            action_visibility: 'opaque',
            action_proxy_config: {
              action_oid: 'act-001',
              environment_oid: 'env-001',
            },
            try_specifications: [
              { mode: 'ERROR', catch_id: 'step-catch-001' },
              { mode: 'TIMEOUT', catch_id: 'step-catch-001', release_on_catch: true },
            ],
          }),
          minimalStep('step-catch-001', 'Handle Error', 'CATCH', {
            catch_id: 'step-catch-001',
          }),
          minimalStep('step-return-001', 'Return Disposition', 'RETURN', {
            return_config: {
              command: 'RETRY',
            },
          }),
          minimalStep('step-return-goto-001', 'Return Goto', 'RETURN', {
            return_config: {
              command: 'GOTO',
              goto_step_oid: 'step-ap-001',
            },
          }),
          minimalStep('step-return-restart-001', 'Return Restart', 'RETURN', {
            return_config: {
              command: 'RESTART',
              restart_mode: 'CLEAN',
            },
          }),
          minimalStep('step-end-001', 'End', 'END'),
        ],
        connections: [
          { from_step_id: 'step-start-001', to_step_id: 'step-ap-001' },
          { from_step_id: 'step-ap-001', to_step_id: 'step-end-001' },
          { from_step_id: 'step-catch-001', to_step_id: 'step-return-001' },
        ],
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// validateWorkflowLibrary — AJV path
// ---------------------------------------------------------------------------

describe('validateWorkflowLibrary — AJV accepts CATCH/RETURN steps', () => {
  it('accepts a library containing a CATCH step with catch_id', () => {
    const lib = makeLibraryWithTryCatchReturn()
    const result = validateWorkflowLibrary(lib)
    expect(result.success).toBe(true)
  })

  it('accepts a library containing a RETURN step with return_config.command = RETRY', () => {
    const lib = {
      ...managedElement('Return Lib', 'lib-return-001'),
      workflow_specifications: [
        {
          ...managedElement('Return Workflow', 'wf-return-001'),
          steps: [
            minimalStep('step-return-001', 'Retry Step', 'RETURN', {
              return_config: { command: 'RETRY' },
            }),
          ],
          connections: [],
        },
      ],
    }
    const result = validateWorkflowLibrary(lib)
    expect(result.success).toBe(true)
  })

  it('accepts a library containing a RETURN step with return_config.command = GOTO', () => {
    const lib = {
      ...managedElement('Return Goto Lib', 'lib-return-goto-001'),
      workflow_specifications: [
        {
          ...managedElement('Return Goto Workflow', 'wf-return-goto-001'),
          steps: [
            minimalStep('step-return-001', 'Goto Step', 'RETURN', {
              return_config: { command: 'GOTO', goto_step_oid: 'step-ap-001' },
            }),
          ],
          connections: [],
        },
      ],
    }
    const result = validateWorkflowLibrary(lib)
    expect(result.success).toBe(true)
  })

  it('accepts a library containing an ACTION PROXY step with try_specifications', () => {
    const lib = {
      ...managedElement('TrySpec Lib', 'lib-try-001'),
      workflow_specifications: [
        {
          ...managedElement('TrySpec Workflow', 'wf-try-001'),
          steps: [
            minimalStep('step-ap-001', 'Action', 'ACTION PROXY', {
              try_specifications: [
                { mode: 'ERROR', catch_id: 'step-catch-001' },
                { mode: 'ABORT', catch_id: 'step-catch-001', release_on_catch: false },
              ],
            }),
          ],
          connections: [],
        },
      ],
    }
    const result = validateWorkflowLibrary(lib)
    expect(result.success).toBe(true)
  })

  it('still rejects a library with an unknown step_type', () => {
    const lib = {
      ...managedElement('Bad Lib', 'lib-bad-001'),
      workflow_specifications: [
        {
          ...managedElement('Bad Workflow', 'wf-bad-001'),
          steps: [minimalStep('step-001', 'Unknown Step', 'INVALID_STEP_TYPE')],
          connections: [],
        },
      ],
    }
    const result = validateWorkflowLibrary(lib)
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// importWorkflow — library fallback path also accepts CATCH/RETURN
// ---------------------------------------------------------------------------

describe('importWorkflow — library fallback accepts CATCH/RETURN steps', () => {
  it('does not return an error when the library JSON contains CATCH and RETURN steps', () => {
    const lib = makeLibraryWithTryCatchReturn()
    const result = importWorkflow(lib)
    expect('error' in result).toBe(false)
  })
})
