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

// @vitest-environment jsdom

import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { WorkflowInlineEditor } from '../WorkflowInlineEditor'
import { useFlowStore } from '@/stores/flowStore'
import { useLibraryStore } from '@/stores/libraryStore'
import { useSpecificationStore } from '@/stores/specificationStore'
import { WORKFLOW_TYPE_NAMES } from '@/lib/workflowTypeNames'

const childState = vi.hoisted(() => ({ isChild: false }))
vi.mock('@/hooks/useIsChildWorkflow', () => ({ useIsChildWorkflow: () => childState.isChild }))

const updateInMemory = vi.fn()

function seed(typeName: string | null) {
  const spec = { id: 's1', name: 'WF', description: '', typeName }
  useLibraryStore.setState({
    specifications: new Map([['l1', [spec]]]) as never,
    selectedSpecificationId: 's1',
    selectedLibraryId: 'l1',
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  childState.isChild = false
  updateInMemory.mockReset()
  useSpecificationStore.setState({ updateInMemory } as never)
  useFlowStore.setState({
    nodes: [],
    edges: [],
    workflowInputs: [],
    workflowOutputs: [],
    workflowValues: [],
    workflowResources: [],
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function typeInput() {
  return screen.getByLabelText('Type') as HTMLInputElement
}

function flush() {
  act(() => {
    vi.advanceTimersByTime(300)
  })
}

describe('WorkflowInlineEditor Type field', () => {
  it('shows the current typeName with the None placeholder and the 10 suggestions in order', () => {
    seed('Phase')
    const { container } = render(<WorkflowInlineEditor />)
    expect(typeInput().value).toBe('Phase')
    expect(typeInput().placeholder).toBe('None')
    const opts = Array.from(container.querySelectorAll('datalist option')).map((o) => (o as HTMLOptionElement).value)
    expect(opts).toEqual([...WORKFLOW_TYPE_NAMES])
    expect(opts).toHaveLength(10)
  })

  it('saves a typed type after the debounce, and null when cleared to whitespace', () => {
    seed(null)
    render(<WorkflowInlineEditor />)
    fireEvent.change(typeInput(), { target: { value: 'Operation' } })
    flush()
    expect(updateInMemory).toHaveBeenCalledWith('s1', { typeName: 'Operation' })
    updateInMemory.mockClear()
    seed('Operation')
    cleanup()
    render(<WorkflowInlineEditor />)
    fireEvent.change(typeInput(), { target: { value: '   ' } })
    flush()
    expect(updateInMemory).toHaveBeenCalledWith('s1', { typeName: null })
  })

  it('rejects 51 characters with a message and does not save typeName, but still saves the name', () => {
    seed(null)
    render(<WorkflowInlineEditor />)
    fireEvent.change(typeInput(), { target: { value: 'x'.repeat(51) } })
    fireEvent.change(screen.getByPlaceholderText('Workflow name...'), { target: { value: 'Renamed' } })
    flush()
    expect(screen.getByText('Type must be 50 characters or fewer.')).toBeTruthy()
    expect(updateInMemory).toHaveBeenCalledTimes(1)
    const patch = updateInMemory.mock.calls[0][1]
    expect(patch).toEqual({ name: 'Renamed' })
    expect('typeName' in patch).toBe(false)
  })

  it('is editable for a child workflow', () => {
    childState.isChild = true
    seed('Phase')
    render(<WorkflowInlineEditor />)
    expect(typeInput().readOnly).toBe(false)
    expect(typeInput().disabled).toBe(false)
  })

  it('is disabled inside a disabled fieldset', () => {
    seed('Phase')
    render(
      <fieldset disabled>
        <WorkflowInlineEditor />
      </fieldset>,
    )
    expect(typeInput().matches(':disabled')).toBe(true)
  })
})
