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
import type { Edge } from '@xyflow/react'
import type { WorkflowNode } from '@/types/nodes'
import type { FormDocument } from '@mission/form-schema'
import { validateWorkflow } from '@/lib/export/workflow-validation'

const node = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const doc = (...jobs: Array<'continue' | 'yes' | 'no'>): FormDocument => ({
  version: 2,
  sections: [
    {
      id: 's1',
      role: 'content',
      rows: [
        {
          id: 'r1',
          blocks: jobs.map((job, i) => ({ id: 'b' + i, type: 'button', label: '', outputValue: job, job })),
        },
      ],
    },
  ],
})
const yesNoEdges: Edge[] = [
  { id: 'e1', source: 's', target: 'q' },
  { id: 'e2', source: 'q', target: 'e', sourceHandle: 'yes' },
  { id: 'e3', source: 'q', target: 'e', sourceHandle: 'no' },
]
const uiEdges: Edge[] = [
  { id: 'e1', source: 's', target: 'u' },
  { id: 'e2', source: 'u', target: 'e' },
]

describe('form button validation (legacy steps without the fixed bar)', () => {
  it('reports a Yes/No step whose form has only a Yes button', () => {
    const errors = validateWorkflow(
      [node('s', 'start'), node('q', 'yesNoStep', { formDocument: doc('yes') }), node('e', 'end')],
      yesNoEdges,
    ).filter((e) => e.nodeId === 'q')
    expect(errors.length).toBeGreaterThan(0)
    for (const e of errors) {
      expect(e.nodeName).toBe('q')
      expect(e.nodeType).toBe('yesNoStep')
      expect(e.message.startsWith('Form buttons: ')).toBe(true)
    }
  })

  it('reports a Continue-kind step whose form has a Yes button', () => {
    const errors = validateWorkflow(
      [node('s', 'start'), node('u', 'userInteractionStep', { formDocument: doc('yes') }), node('e', 'end')],
      uiEdges,
    ).filter((e) => e.nodeId === 'u')
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0].nodeType).toBe('userInteractionStep')
  })

  it('passes forms with no job buttons, valid buttons, or no formDocument', () => {
    const run = (data: Record<string, unknown>) =>
      validateWorkflow([node('s', 'start'), node('u', 'userInteractionStep', data), node('e', 'end')], uiEdges)
    expect(run({ formDocument: doc() })).toEqual([])
    expect(run({ formDocument: doc('continue') })).toEqual([])
    expect(run({})).toEqual([])
  })

  it('skips fixed-bar steps: their buttons live in the bar, not the form', () => {
    const errors = validateWorkflow(
      [node('s', 'start'), node('q', 'yesNoStep', { buttonBar: {}, formDocument: doc('yes') }), node('e', 'end')],
      yesNoEdges,
    ).filter((e) => e.nodeId === 'q')
    expect(errors).toEqual([])
  })
})

describe('form checks from the user rulings of 2026-11-14', () => {
  const formOf = (blocks: FormDocument['sections'][0]['rows'][0]['blocks']): FormDocument => ({
    version: 2,
    sections: [{ id: 's1', role: 'content', rows: [{ id: 'r1', blocks }] }],
  })
  const uiErrors = (data: Record<string, unknown>) =>
    validateWorkflow([node('s', 'start'), node('u', 'userInteractionStep', data), node('e', 'end')], uiEdges).filter(
      (e) => e.nodeId === 'u',
    )

  it('X.7: a legacy Yes/No step refuses a button with no job that is not true/false', () => {
    const form = formOf([
      { id: 'y', type: 'button', label: 'Yes', outputValue: 'true' },
      { id: 'n', type: 'button', label: 'No', outputValue: 'false' },
      { id: 'h', type: 'button', label: 'Hold', outputValue: 'hold' },
    ])
    const errors = validateWorkflow(
      [node('s', 'start'), node('q', 'yesNoStep', { formDocument: form }), node('e', 'end')],
      yesNoEdges,
    ).filter((e) => e.nodeId === 'q')
    expect(errors.map((e) => e.message)).toEqual(['Form buttons: Button "Hold" needs a job — pick Yes or No.'])
  })

  it('X.6: a required field hidden on a screen type is refused, on fixed-bar steps too', () => {
    const form = formOf([
      {
        id: 'a',
        type: 'textInput',
        fieldName: 'lot',
        label: 'Lot',
        required: true,
        layout: { visible: { base: true, phone: false } },
      },
    ])
    for (const data of [{ formDocument: form }, { formDocument: form, buttonBar: {} }]) {
      expect(uiErrors(data).map((e) => e.message)).toContain(
        'Form: "Lot" is required but is hidden on Phone — show it there or make it optional.',
      )
    }
  })

  it('X.10: two options with one value are refused', () => {
    const form = formOf([
      {
        id: 'r',
        type: 'radio',
        fieldName: 'size',
        label: 'Size',
        options: [
          { label: 'S', value: 's' },
          { label: 'Small', value: 's' },
        ],
      },
    ])
    expect(uiErrors({ formDocument: form, buttonBar: {} }).map((e) => e.message)).toEqual([
      'Form: "Size" has more than one option with the value "s" — each option needs its own value.',
    ])
  })

  it('a visible required field and distinct options pass', () => {
    const form = formOf([
      { id: 'a', type: 'textInput', fieldName: 'lot', required: true },
      {
        id: 'r',
        type: 'radio',
        fieldName: 'size',
        options: [
          { label: 'S', value: 's' },
          { label: 'M', value: 'm' },
        ],
      },
    ])
    expect(uiErrors({ formDocument: form, buttonBar: {} })).toEqual([])
  })
})
