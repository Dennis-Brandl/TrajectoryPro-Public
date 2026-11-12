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
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ActionsPanel } from '../ActionsPanel'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import { useFlowStore } from '@/stores/flowStore'
import type { FormDocument } from '@mission/form-schema'
import type { WorkflowNode } from '@/types/nodes'

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

function open(nodeType: string, document: FormDocument) {
  useFlowStore.setState({
    nodes: [{ id: 'n1', type: nodeType, position: { x: 0, y: 0 }, data: { label: 'n1' } } as unknown as WorkflowNode],
  })
  useFormDocumentStore.getState().openForNode('n1', document)
}

beforeEach(() => {
  useFlowStore.setState({ nodes: [] })
})

describe('ActionsPanel never-stuck report', () => {
  it('lists each problem in an alert while the form would leave an operator stuck', () => {
    open('userInteractionStep', doc('yes'))
    render(<ActionsPanel draft={{ kind: 'continue', label: 'Continue' }} onChange={() => {}} />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent?.length).toBeGreaterThan(0)
    expect(alert.querySelectorAll('li').length).toBeGreaterThan(0)
  })

  it('shows nothing when the buttons are fine or absent', () => {
    open('userInteractionStep', doc('continue'))
    const { unmount } = render(<ActionsPanel draft={{ kind: 'continue', label: 'Continue' }} onChange={() => {}} />)
    expect(screen.queryByRole('alert')).toBeNull()
    unmount()
    open('yesNoStep', doc())
    render(<ActionsPanel draft={{ kind: 'yesno', yes: 'Yes', no: 'No' }} onChange={() => {}} />)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('Buttons panel', () => {
  it('is titled Buttons and offers no Convert buttons', () => {
    open('userInteractionStep', doc())
    render(<ActionsPanel draft={{ kind: 'continue', label: 'Continue' }} onChange={() => {}} />)
    expect(screen.getByText('Buttons')).toBeTruthy()
    expect(screen.queryByText('Actions')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Convert buttons' })).toBeNull()
  })

  it('a legacy step (no fixed bar) shows text only, no size or color', () => {
    open('userInteractionStep', doc())
    render(<ActionsPanel draft={{ kind: 'continue', label: 'Continue' }} onChange={() => {}} />)
    expect(screen.queryByLabelText('Text size')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open color picker' })).toBeNull()
  })

  it('Buttons panel edits size and color of a fixed step', () => {
    openFixed('userInteractionStep')
    const onChange = vi.fn()
    render(<ActionsPanel draft={{ kind: 'continue', label: 'Go' }} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Text size'), { target: { value: 'lg' } })
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'continue', label: 'Go', size: 'lg' })
    fireEvent.click(screen.getByRole('button', { name: 'Open color picker' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select color #22c55e' }))
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'continue', label: 'Go', color: '#22c55e' })
  })

  it('a fixed Yes/No step has one size and a color each for Yes and No', () => {
    openFixed('yesNoStep')
    const onChange = vi.fn()
    render(<ActionsPanel draft={{ kind: 'yesno', yes: 'Yes', no: 'No' }} onChange={onChange} />)
    expect(screen.getAllByLabelText('Text size')).toHaveLength(1)
    const pickers = screen.getAllByRole('button', { name: 'Open color picker' })
    expect(pickers).toHaveLength(2)
    fireEvent.click(pickers[1])
    fireEvent.click(screen.getByRole('button', { name: 'Select color #ef4444' }))
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'yesno', yes: 'Yes', no: 'No', noColor: '#ef4444' })
  })
})

function openFixed(nodeType: string) {
  useFlowStore.setState({
    nodes: [
      {
        id: 'n1',
        type: nodeType,
        position: { x: 0, y: 0 },
        data: { label: 'n1', buttonBar: {} },
      } as unknown as WorkflowNode,
    ],
  })
  useFormDocumentStore.getState().openForNode('n1', doc())
}
