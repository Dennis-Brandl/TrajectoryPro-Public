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
import { describe, expect, it } from 'vitest'
import { formDocumentJsonSchema } from '@mission/form-schema'
import designerCopy from '@/lib/schemas/form-document.json'
import { validateWorkflowLibrary } from '@/lib/import/schema-validator'

/** The committed wire-contract copy must never silently diverge from FormKit's canonical
 *  schema. $id intentionally differs — the copy
 *  is re-homed under the trajectorypro.io contract namespace. */
function withoutId(schema: Record<string, unknown>): Record<string, unknown> {
  const { $id: _id, ...rest } = schema
  return rest
}

describe('form-document.json drift guard', () => {
  it('matches @mission/form-schema exactly (modulo $id)', () => {
    expect(withoutId(designerCopy as Record<string, unknown>)).toEqual(
      withoutId(formDocumentJsonSchema as Record<string, unknown>),
    )
  })
  it('is homed under the Designer contract namespace', () => {
    expect((designerCopy as { $id?: string }).$id).toBe('https://trajectorypro.io/schemas/form-document.json')
  })
})

function libraryWithStepField(stepExtra: Record<string, unknown>) {
  return {
    schemaVersion: '5.0',
    local_id: 'lib',
    oid: 'LIB1',
    version: '1.0.0',
    last_modified_date: '2026-07-23T00:00:00.000Z',
    workflow_specifications: [
      {
        local_id: 'wf',
        oid: 'WF1',
        version: '1.0.0',
        last_modified_date: '2026-07-23T00:00:00.000Z',
        steps: [
          {
            local_id: 's1',
            oid: 'S1',
            version: '1.0.0',
            last_modified_date: '2026-07-23T00:00:00.000Z',
            step_type: 'USER_INTERACTION',
            ...stepExtra,
          },
        ],
        connections: [],
      },
    ],
  }
}

describe('envelope-level form_document validation', () => {
  const validDoc = { version: 2, sections: [{ id: 'content', role: 'content', rows: [] }] }

  it('accepts a valid form_document via $ref', () => {
    expect(validateWorkflowLibrary(libraryWithStepField({ form_document: validDoc })).success).toBe(true)
  })
  it('rejects a structurally invalid form_document (live $ref, not decorative)', () => {
    const bad = { version: 2, sections: [{ id: 'content', role: 'not-a-role', rows: [] }] }
    expect(validateWorkflowLibrary(libraryWithStepField({ form_document: bad })).success).toBe(false)
  })
  it('still accepts legacy form_layout_config (deprecated-but-valid)', () => {
    const legacy = [{ deviceType: 'desktop', canvasWidth: 768, canvasHeight: 1024, elements: [] }]
    expect(validateWorkflowLibrary(libraryWithStepField({ form_layout_config: legacy })).success).toBe(true)
  })
})
