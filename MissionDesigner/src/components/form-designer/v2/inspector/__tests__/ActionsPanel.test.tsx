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
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ActionsPanel } from '../ActionsPanel'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import { useFlowStore } from '@/stores/flowStore'
import type { FormDocument } from '@mission/form-schema'
import type { WorkflowNode } from '@/types/nodes'

const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: vi.fn() } }))
const canEditMock = vi.hoisted(() => ({ value: true }))
vi.mock('@/hooks/useCanEditActiveSpec', () => ({ useCanEditActiveSpec: () => canEditMock.value }))

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
  canEditMock.value = true
  toastSuccess.mockClear()
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

describe('ActionsPanel Convert buttons', () => {
  const panel = () => render(<ActionsPanel draft={{ kind: 'continue', label: 'Continue' }} onChange={() => {}} />)
  const jobsOf = () =>
    useFormDocumentStore
      .getState()
      .document.sections.flatMap((s) => s.rows.flatMap((r) => r.blocks))
      .map((b) => (b as { job?: string }).job)

  it('is disabled when the spec cannot be edited', () => {
    canEditMock.value = false
    open('userInteractionStep', doc())
    panel()
    expect((screen.getByRole('button', { name: 'Convert buttons' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('adds the bottom-bar button, toasts the changes, and undoes in one step', () => {
    open('userInteractionStep', doc())
    const before = useFormDocumentStore.getState().document
    panel()
    fireEvent.click(screen.getByRole('button', { name: 'Convert buttons' }))
    expect(jobsOf()).toContain('continue')
    expect(useFormDocumentStore.getState().isDirty).toBe(true)
    expect(toastSuccess).toHaveBeenCalledTimes(1)
    act(() => useFormDocumentStore.temporal.getState().undo())
    expect(useFormDocumentStore.getState().document).toBe(before)
  })

  it('says Nothing to convert. and leaves the document alone when nothing changed', () => {
    open('userInteractionStep', doc('continue'))
    const before = useFormDocumentStore.getState().document
    panel()
    fireEvent.click(screen.getByRole('button', { name: 'Convert buttons' }))
    expect(useFormDocumentStore.getState().document).toBe(before)
    expect(toastSuccess).toHaveBeenCalledWith('Nothing to convert.')
  })

  it('shows buttons that still need a job in the error box', () => {
    const jobless: FormDocument = {
      version: 2,
      sections: [
        {
          id: 's1',
          role: 'content',
          rows: [{ id: 'r1', blocks: [{ id: 'x', type: 'button', label: 'Go', outputValue: 'go' }] }],
        },
      ],
    }
    open('yesNoStep', jobless)
    panel()
    fireEvent.click(screen.getByRole('button', { name: 'Convert buttons' }))
    expect(screen.getByRole('alert').textContent).toMatch(/needs a job/i)
  })
})
