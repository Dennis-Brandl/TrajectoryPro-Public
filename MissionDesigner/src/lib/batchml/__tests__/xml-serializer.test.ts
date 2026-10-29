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
import { serializeMasterRecipe, parseBatchmlXml } from '../xml-serializer'
import type { B2mmlMasterRecipe } from '../batchml-types'

const recipe: B2mmlMasterRecipe = {
  id: 'R1',
  version: '1.0.0',
  description: ['hello'],
  procedureLogic: {
    step: [{ id: 'st1', recipeElementId: 're1', recipeElementVersion: '1.0.0' }],
    transition: [{ id: 't1', condition: 'TRUE' }],
    link: [
      {
        id: 'l1',
        fromId: [{ value: 'st1', type: 'Step', idScope: 'Internal' }],
        toId: [{ value: 't1', type: 'Transition', idScope: 'Internal' }],
        linkType: 'ControlLink',
        depiction: 'None',
      },
    ],
  },
  otherInformation: [{ id: 'k', value: [{ valueString: 'v', dataType: 'string', unitOfMeasure: 'none' }] }],
}

describe('xml-serializer', () => {
  it('emits a MESA B2MML MasterRecipe document', () => {
    const xml = serializeMasterRecipe(recipe)
    expect(xml).toContain('<?xml')
    expect(xml).toContain('<MasterRecipe')
    expect(xml).toContain('http://www.mesa.org/xml/B2MML')
    expect(xml).toContain('<RecipeElementID>re1</RecipeElementID>')
    expect(xml).toContain('<LinkType>ControlLink</LinkType>')
  })

  it('parse can locate the root MasterRecipe and OtherInformation', () => {
    const xml = serializeMasterRecipe(recipe)
    const parsed = parseBatchmlXml(xml)
    const mr = (parsed as Record<string, unknown>).MasterRecipe as Record<string, unknown>
    expect(mr.ID).toBe('R1')
    expect(JSON.stringify(mr)).toContain('OtherInformation')
  })

  it('parses singleton repeatable B2MML elements as 1-element arrays', () => {
    const xml = serializeMasterRecipe(recipe)
    const parsed = parseBatchmlXml(xml)
    const mr = (parsed as Record<string, unknown>).MasterRecipe as Record<string, unknown>
    expect(Array.isArray(mr.OtherInformation)).toBe(true)
    expect((mr.OtherInformation as unknown[]).length).toBe(1)
    const procedureLogic = mr.ProcedureLogic as Record<string, unknown>
    expect(Array.isArray(procedureLogic.Step)).toBe(true)
  })
})
