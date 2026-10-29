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
import type { FormDocument } from '@mission/form-schema'
import { exportWorkflow } from '../workflow-exporters'
import { CURRENT_SCHEMA_VERSION } from '../export-types'
import { importWorkflow } from '@/lib/import/workflow-importers'
import { exportBatchml } from '@/lib/batchml/batchml-exporter'
import type { Specification } from '@/types/library'
import type { WorkflowNode } from '@/types/nodes'

const doc: FormDocument = {
  version: 2,
  sections: [
    {
      id: 'content',
      role: 'content',
      rows: [
        {
          id: 'r1',
          blocks: [
            { id: 'b1', type: 'textInput', fieldName: 'Text_1', label: 'Name', layout: { span: { base: 6 } } },
            { id: 'b2', type: 'textInput', fieldName: 'Text_2', label: 'Batch', layout: { span: { base: 6 } } },
          ],
        },
      ],
    },
  ],
}

function specWithFormStep(formDocument: FormDocument = doc): { spec: Specification; nodes: WorkflowNode[] } {
  const nodes = [
    {
      id: 'S1',
      type: 'userInteractionStep',
      position: { x: 0, y: 0 },
      data: { label: 'Fill', stepType: 'userInteractionStep', formDocument },
    },
  ] as unknown as WorkflowNode[]
  const spec = {
    id: 'WF1',
    libraryId: 'L1',
    name: 'wf',
    description: null,
    version: '1.0.0',
    state: 'Draft',
    data: { nodes, edges: [] },
    history: [],
    createdAt: 0,
    updatedAt: 0,
  } as unknown as Specification
  return { spec, nodes }
}

describe('form_document round-trip', () => {
  it('export → import → export is identity on form_document, at 5.0, with no form_layout_config', () => {
    const { spec, nodes } = specWithFormStep()
    const exported = exportWorkflow(spec, nodes, [])
    expect(exported.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(exported.steps[0].form_document).toEqual(doc)
    expect(exported.steps[0].form_layout_config).toBeUndefined()

    const imported = importWorkflow(exported)
    expect('error' in imported).toBe(false)
    const reNodes = (imported as { nodes: WorkflowNode[] }).nodes
    expect((reNodes[0].data as { formDocument?: FormDocument }).formDocument).toEqual(doc)

    const reExported = exportWorkflow(spec, reNodes, [])
    expect(reExported.steps[0].form_document).toEqual(exported.steps[0].form_document)
  })

  it('a LEGACY 4.0 import re-exports as 5.0 with a minted form_document and no form_layout_config', () => {
    const legacy = {
      schemaVersion: '4.0',
      local_id: 'wf',
      oid: 'WF1',
      version: '1.0.0',
      last_modified_date: '2026-07-23T00:00:00.000Z',
      connections: [],
      steps: [
        {
          local_id: 's1',
          oid: 'S1',
          version: '1.0.0',
          last_modified_date: '2026-07-23T00:00:00.000Z',
          step_type: 'USER_INTERACTION',
          form_layout_config: (['phone', 'tablet', 'desktop'] as const).map((deviceType) => ({
            deviceType,
            canvasWidth: 768,
            canvasHeight: 1024,
            elements: [
              { type: 'text', content: { content: 'Hi', plainText: 'Hi' }, x: 40, y: 40, width: 400, height: 30 },
            ],
          })),
        },
      ],
    }
    const imported = importWorkflow(legacy)
    expect('error' in imported).toBe(false)
    const reNodes = (imported as { nodes: WorkflowNode[] }).nodes
    const { spec } = specWithFormStep()
    const reExported = exportWorkflow(spec, reNodes, [])
    expect(reExported.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(reExported.steps[0].form_document).toBeDefined()
    expect((reExported.steps[0].form_document as FormDocument).sections[0].rows[0].blocks[0].type).toBe('text')
    expect(reExported.steps[0].form_layout_config).toBeUndefined()
  })

  it('an esignature block survives export and import verbatim (spec 2026-09-06 D12)', () => {
    const esig = {
      id: 'e1',
      type: 'esignature' as const,
      fieldName: 'approval',
      label: 'Approve',
      meaning: 'I approve',
      roleName: 'QA Lead',
      requireDifferentUser: true,
      outputParameter: 'approver',
    }
    const esigDoc: FormDocument = {
      version: 2,
      sections: [{ id: 'content', role: 'content', rows: [{ id: 'r1', blocks: [esig] }] }],
    }
    const { spec, nodes } = specWithFormStep(esigDoc)
    const exported = exportWorkflow(spec, nodes, [])
    const imported = importWorkflow(exported)
    expect('error' in imported).toBe(false)
    const reNodes = (imported as { nodes: WorkflowNode[] }).nodes
    const roundTripped = (reNodes[0].data as { formDocument?: FormDocument }).formDocument as FormDocument
    expect(roundTripped.sections[0].rows[0].blocks[0]).toEqual(esig)
  })

  it('BatchML canonical payload carries form_document (shared envelope — zero BatchML-specific code)', () => {
    const { spec, nodes } = specWithFormStep()
    const envelope = exportWorkflow(spec, nodes, [])
    const xml = exportBatchml(envelope)
    const b64 = /<(?:\w+:)?OtherInformation[\s\S]*?>([\s\S]*?)<\/(?:\w+:)?OtherInformation>/.exec(xml)?.[1] ?? ''
    const payloadMatch = /[A-Za-z0-9+/=]{40,}/.exec(b64)
    expect(payloadMatch).toBeTruthy()
    const decoded = JSON.parse(Buffer.from(payloadMatch![0], 'base64').toString('utf8'))
    expect(decoded.steps[0].form_document).toEqual(doc)
  })
})
