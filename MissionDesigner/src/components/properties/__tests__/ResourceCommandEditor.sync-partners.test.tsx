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

import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ResourceCommandEditor } from '../ResourceCommandEditor'
import { useFlowStore } from '@/stores/flowStore'
import { useLibraryStore } from '@/stores/libraryStore'
import type { StepResourceCommand, WorkflowNode } from '@/types/nodes'

beforeEach(() => {
  useFlowStore.setState({
    nodes: [
      {
        id: 'self',
        type: 'userInteractionStep',
        position: { x: 0, y: 0 },
        data: { label: 'Me', stepType: 'userInteractionStep' },
      } as WorkflowNode,
    ],
    edges: [],
    workflowInputs: [{ id: 'p-b', name: 'Batches', description: '' }],
    workflowOutputs: [],
    workflowValues: [],
    workflowResources: [{ id: 'r1', name: 'Chan', resourceType: 'Sync', count: 1 }],
  })
  useLibraryStore.setState({ specifications: new Map(), selectedSpecificationId: null })
})

function Host({
  initial,
  onChange,
}: {
  initial: StepResourceCommand[]
  onChange?: (c: StepResourceCommand[]) => void
}) {
  const [cmds, setCmds] = useState(initial)
  return (
    <ResourceCommandEditor
      resourceCommands={cmds}
      onChange={(c) => {
        setCmds(c)
        onChange?.(c)
      }}
      nodeId="self"
    />
  )
}

const syncChan: StepResourceCommand = { id: 'c1', resourceName: 'Chan', commandType: 'Synchronize', count: 1 }

describe('ResourceCommandEditor Synchronize partners', () => {
  it('shows Partners with Text selected and 2 by default', () => {
    render(<Host initial={[syncChan]} />)
    expect((screen.getByRole('radio', { name: 'Text' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('textbox', { name: 'Partners' }) as HTMLInputElement).value).toBe('2')
  })

  it('typing stores the text as entered', () => {
    const onChange = vi.fn()
    render(<Host initial={[syncChan]} onChange={onChange} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Partners' }), { target: { value: 'four' } })
    expect(onChange).toHaveBeenLastCalledWith([{ ...syncChan, partners: 'four' }])
  })

  it('choosing Source shows the picker and stores the picked key', () => {
    const onChange = vi.fn()
    render(<Host initial={[syncChan]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Source' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show sources' }))
    fireEvent.click(screen.getByText('Batches'))
    expect(onChange).toHaveBeenLastCalledWith([
      { ...syncChan, partnersValueType: 'property', partnersProperty: 'Batches' },
    ])
  })

  it('Send has no Partners field', () => {
    render(<Host initial={[{ ...syncChan, commandType: 'Send' }]} />)
    expect(screen.queryByRole('textbox', { name: 'Partners' })).toBeNull()
  })
})
