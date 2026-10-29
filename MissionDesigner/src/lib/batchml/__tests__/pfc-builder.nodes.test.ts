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
import { buildMasterRecipe, stepTypeToRecipeElementType } from '../pfc-builder'
import type { MasterWorkflowSpecification, MasterWorkflowStep } from '@/lib/packageFormat/export-types'

function step(oid: string, local_id: string, step_type: MasterWorkflowStep['step_type']): MasterWorkflowStep {
  return { oid, local_id, version: '1.0.0', last_modified_date: '2026-01-01T00:00:00Z', step_type }
}

function spec(steps: MasterWorkflowStep[]): MasterWorkflowSpecification {
  return {
    oid: 'wf1',
    local_id: 'My Workflow',
    version: '1.0.0',
    last_modified_date: '2026-01-01T00:00:00Z',
    steps,
    connections: [],
  }
}

describe('pfc-builder node mapping', () => {
  it('maps step types to recipe element types', () => {
    expect(stepTypeToRecipeElementType('START')).toBe('Begin')
    expect(stepTypeToRecipeElementType('END')).toBe('End')
    expect(stepTypeToRecipeElementType('ACTION PROXY')).toBe('Phase')
    expect(stepTypeToRecipeElementType('WORKFLOW PROXY')).toBe('Operation')
    expect(stepTypeToRecipeElementType('SELECT 1')).toBe('Other')
  })

  it('creates one Step + one RecipeElement per non-exception node', () => {
    const mr = buildMasterRecipe(
      spec([step('s1', 'Start', 'START'), step('s2', 'Do Thing', 'ACTION PROXY'), step('s3', 'End', 'END')]),
    )
    expect(mr.procedureLogic?.step).toHaveLength(3)
    expect(mr.recipeElement).toHaveLength(3)
    expect(mr.recipeElement?.find((r) => r.id === 's2')?.recipeElementType).toBe('Phase')
    // Step references its recipe element by id
    expect(mr.procedureLogic?.step.find((s) => s.id === 's1')?.recipeElementId).toBe('s1')
  })

  it('omits CATCH/RETURN nodes from the PFC', () => {
    const mr = buildMasterRecipe(
      spec([step('s1', 'Start', 'START'), step('c1', 'Catch', 'CATCH'), step('r1', 'Return', 'RETURN')]),
    )
    expect(mr.procedureLogic?.step.map((s) => s.id)).toEqual(['s1'])
  })
})
