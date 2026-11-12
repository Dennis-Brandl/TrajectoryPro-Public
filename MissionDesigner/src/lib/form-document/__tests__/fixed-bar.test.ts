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
import type { FormDocument } from '@mission/form-schema'
import type { Specification } from '@/types/library'
import type { StepNodeData, WorkflowNode } from '@/types/nodes'
import { convertToFixedBar } from '../fixed-bar'
import { exportWorkflow } from '@/lib/packageFormat/workflow-exporters'
import { importWorkflow } from '@/lib/import/workflow-importers'

function doc(blocks: Array<Record<string, unknown>>): FormDocument {
  return {
    version: 2,
    sections: [{ id: 's1', rows: [{ id: 'r1', blocks: blocks as never }] }],
  } as unknown as FormDocument
}
const btn = (id: string, extra: Record<string, unknown>) => ({
  id,
  type: 'button',
  label: 'B',
  outputValue: 'x',
  ...extra,
})
const buttonsIn = (d?: FormDocument) =>
  (d?.sections ?? []).flatMap((s) => s.rows.flatMap((r) => r.blocks)).filter((b) => b.type === 'button')
const base = (extra: Partial<StepNodeData>): StepNodeData => ({ label: 'S', stepType: 'userInteractionStep', ...extra })

describe('convertToFixedBar', () => {
  it("takes text and color from the form's Continue button when the step has none", () => {
    const d = base({
      formDocument: doc([
        { id: 't', type: 'text', text: 'hi' },
        btn('b1', { label: 'Go on', outputValue: 'continue', job: 'continue', color: '#123456' }),
        btn('b2', { label: 'Other' }),
        btn('b3', { label: 'Other2' }),
      ]),
    })
    const r = convertToFixedBar('userInteractionStep', d, [])
    expect(r.changed).toBe(true)
    expect(r.data.buttonBar?.color).toBe('#123456')
    expect(r.data.uiParameters?.find((p) => p.type === 'Button')?.value).toBe('Go on')
    expect(buttonsIn(r.data.formDocument)).toHaveLength(0)
    expect(r.note).toContain('3 button(s)')
    expect(r.data.allowBack).toBe(false)
    expect(r.data.allowStop).toBe(false)
    expect(buttonsIn(d.formDocument)).toHaveLength(3) // input untouched
  })

  it('yes/no takes both buttons', () => {
    const d = base({
      stepType: 'yesNoStep',
      formDocument: doc([
        btn('y', { label: 'Sure', job: 'yes', color: '#0a0' }),
        btn('n', { label: 'Nope', job: 'no', color: '#a00' }),
      ]),
    })
    const r = convertToFixedBar('yesNoStep', d, [])
    expect(r.data.buttonBar).toMatchObject({ yesColor: '#0a0', noColor: '#a00' })
    const p = r.data.uiParameters?.find((x) => x.type === 'YesNoButtons')
    expect(p?.value).toBe('Sure')
    expect(p?.value2).toBe('Nope')
  })

  it('yes/no falls back to job-less buttons by output value true/false', () => {
    const d = base({
      stepType: 'yesNoStep',
      formDocument: doc([
        btn('y', { label: 'Sure', outputValue: 'true', color: '#0a0', size: 'lg' }),
        btn('n', { label: 'Nope', outputValue: 'false', color: '#a00' }),
      ]),
    })
    const r = convertToFixedBar('yesNoStep', d, ['true', 'false'])
    expect(r.data.buttonBar).toMatchObject({ yesColor: '#0a0', noColor: '#a00', size: 'lg' })
    const p = r.data.uiParameters?.find((x) => x.type === 'YesNoButtons')
    expect(p?.value).toBe('Sure')
    expect(p?.value2).toBe('Nope')
  })

  it('yes/no true/false routing raises no routing problem; other values do', () => {
    const d = base({
      stepType: 'yesNoStep',
      formDocument: doc([
        btn('y', { outputValue: 'true' }),
        btn('n', { outputValue: 'false' }),
        btn('m', { outputValue: 'maybe' }),
      ]),
    })
    expect(convertToFixedBar('yesNoStep', d, ['true', 'false']).routingProblem).toBeNull()
    expect(convertToFixedBar('yesNoStep', d, ['maybe']).routingProblem).toContain('"maybe"')
  })

  it('step labels win over button labels', () => {
    const d = base({
      uiParameters: [{ id: 'p', type: 'Button', value: 'Step text' }],
      formDocument: doc([btn('b1', { label: 'Form text', job: 'continue' })]),
    })
    const r = convertToFixedBar('userInteractionStep', d, [])
    expect(r.data.uiParameters?.find((p) => p.type === 'Button')?.value).toBe('Step text')
  })

  it('already fixed is unchanged', () => {
    const d = base({ buttonBar: { color: '#fff' }, allowBack: true })
    const r = convertToFixedBar('userInteractionStep', d, [])
    expect(r.changed).toBe(false)
    expect(r.data).toEqual(d)
  })

  it('step without buttons just becomes fixed', () => {
    const r = convertToFixedBar('userInteractionStep', base({}), [])
    expect(r.changed).toBe(true)
    expect(r.note).toBeNull()
    expect(r.data.buttonBar).toBeDefined()
  })

  it('flags a removed button whose output value an outgoing condition uses', () => {
    const d = base({ formDocument: doc([btn('b', { label: 'Rework', outputValue: 'rework' })]) })
    const r = convertToFixedBar('userInteractionStep', d, ['rework'])
    expect(r.routingProblem).toBe(
      'This step routed on which button was pressed ("rework"). Make it a Yes/No step or add a decision step after it.',
    )
    expect(convertToFixedBar('userInteractionStep', d, ['other']).routingProblem).toBeNull()
  })
})

describe('fixed bar export/import round trip', () => {
  const spec: Specification = {
    id: 'w',
    libraryId: 'l',
    name: 'wf',
    description: null,
    version: '1.0.0',
    state: 'Draft',
    data: {},
    history: [],
    createdAt: 0,
    updatedAt: 0,
  }
  const node = (id: string, extra: Partial<StepNodeData>): WorkflowNode =>
    ({ id, type: 'userInteractionStep', position: { x: 0, y: 0 }, data: base({ label: id, ...extra }) }) as WorkflowNode

  it('round-trips a fixed UI step; legacy exports none of the fields', () => {
    const nodes = [
      node('fx', {
        allowBack: true,
        allowStop: true,
        buttonBar: { color: '#0a0', size: 'lg', yesColor: '#0b0', noColor: '#b00' },
      }),
      node('old', {}),
    ]
    const exported = exportWorkflow(spec, nodes, [] as Edge[])
    const fx = exported.steps.find((s) => s.oid === 'fx')!
    expect(fx.button_bar).toEqual({ format: 'fixed', color: '#0a0', size: 'lg', yes_color: '#0b0', no_color: '#b00' })
    expect(fx.allow_back).toBe(true)
    expect(fx.allow_stop).toBe(true)
    const old = exported.steps.find((s) => s.oid === 'old')!
    expect('button_bar' in old || 'allow_back' in old || 'allow_stop' in old).toBe(false)

    const res = importWorkflow(exported)
    if ('error' in res) throw new Error(String(res.error))
    const d = res.nodes.find((n) => n.id === 'fx')!.data as StepNodeData
    expect(d.buttonBar).toEqual({ color: '#0a0', size: 'lg', yesColor: '#0b0', noColor: '#b00' })
    expect(d.allowBack).toBe(true)
    expect(d.allowStop).toBe(true)
    const od = res.nodes.find((n) => n.id === 'old')!.data as StepNodeData
    expect(od.buttonBar).toBeUndefined()
    expect(od.allowBack).toBeUndefined()
  })
})
