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
import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ResourceCommandEditor } from '../ResourceCommandEditor'
import { useFlowStore } from '@/stores/flowStore'
import { useLibraryStore } from '@/stores/libraryStore'
import type { ParameterSpec, StepResourceCommand, WorkflowNode } from '@/types/nodes'
import type { Specification } from '@/types/library'

function param(name: string): ParameterSpec {
  return { id: `p-${name}`, name, description: '' }
}

function node(id: string, label: string, data: Record<string, unknown>): WorkflowNode {
  return {
    id,
    type: 'userInteractionStep',
    position: { x: 0, y: 0 },
    data: { label, stepType: 'userInteractionStep', ...data },
  } as WorkflowNode
}

/** A workflow with an attached environment that carries Action Properties. */
function seedLibrary() {
  const env = {
    id: 'env-1',
    libraryId: 'lib-env',
    name: 'Kitchen',
    description: null,
    version: '1.0.0',
    state: 'Draft',
    data: { actionProperties: [{ id: 'ap-1', name: 'Sensor', entries: [{ id: 'e1', name: 'Value', value: '' }] }] },
    history: [],
    createdAt: 0,
    updatedAt: 0,
  } as Specification
  const wf = { ...env, id: 'wf-1', libraryId: 'lib-wf', name: 'Flow', data: { environmentSpecIds: ['env-1'] } }
  useLibraryStore.setState({
    specifications: new Map([
      ['lib-env', [env]],
      ['lib-wf', [wf as Specification]],
    ]),
    selectedSpecificationId: 'wf-1',
  })
}

beforeEach(() => {
  useFlowStore.setState({
    nodes: [
      node('self', 'This Step', { inputs: [param('ownInput')], outputs: [param('ownOutput')] }),
      node('up', 'Upstream Step', { outputs: [param('upstreamOut')] }),
    ],
    edges: [],
    workflowInputs: [param('flowIn')],
    workflowOutputs: [],
    workflowValues: [],
    workflowResources: [
      { id: 'r1', name: 'Slots', resourceType: 'Count Limited', count: 5 },
      { id: 'r2', name: 'Mutex', resourceType: 'Single Use', count: 1 },
    ],
  })
  useLibraryStore.setState({ specifications: new Map(), selectedSpecificationId: null })
})

/** Controlled host so edits flow back into the editor like NodeInlineEditor's draft. */
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

const PICKER = 'Select workflow or property source...'
const acquireSlots: StepResourceCommand = { id: 'c1', resourceName: 'Slots', commandType: 'Acquire', count: 3 }

describe('ResourceCommandEditor Count Text/Source', () => {
  it('shows Text/Source on a Count Limited row, Text selected with the number field by default', () => {
    render(<Host initial={[acquireSlots]} />)
    const text = screen.getByRole('radio', { name: 'Text' }) as HTMLInputElement
    const source = screen.getByRole('radio', { name: 'Source' }) as HTMLInputElement
    expect(text.checked).toBe(true)
    expect(source.checked).toBe(false)
    expect((screen.getByRole('spinbutton', { name: 'Count' }) as HTMLInputElement).value).toBe('3')
    expect(screen.queryByPlaceholderText(PICKER)).toBeNull()
  })

  it('offers Text/Source on Count Limited Release rows too', () => {
    render(<Host initial={[{ ...acquireSlots, id: 'c2', commandType: 'Release' }]} />)
    expect(screen.getByRole('radio', { name: 'Source' })).toBeTruthy()
  })

  it('choosing Source shows the picker and stores the picked key', () => {
    const onChange = vi.fn()
    render(<Host initial={[acquireSlots]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Source' }))
    expect(onChange).toHaveBeenLastCalledWith([{ ...acquireSlots, countValueType: 'property' }])
    expect(screen.queryByRole('spinbutton', { name: 'Count' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show sources' }))
    fireEvent.click(screen.getByText('upstreamOut'))
    expect(onChange).toHaveBeenLastCalledWith([
      { ...acquireSlots, countValueType: 'property', countProperty: 'upstreamOut' },
    ])
  })

  it('the picker offers workflow parameters and other steps outputs, not own inputs/outputs or Action Properties', () => {
    seedLibrary()
    render(<Host initial={[{ ...acquireSlots, countValueType: 'property' }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show sources' }))
    expect(screen.getByText('Workflow Input Parameters')).toBeTruthy()
    expect(screen.getByText('flowIn')).toBeTruthy()
    expect(screen.getByText('Step: Upstream Step')).toBeTruthy()
    expect(screen.getByText('upstreamOut')).toBeTruthy()
    expect(screen.queryByText('Step Input Parameters')).toBeNull()
    expect(screen.queryByText('ownInput')).toBeNull()
    expect(screen.queryByText('ownOutput')).toBeNull()
    expect(screen.queryByText(/Action Properties/)).toBeNull()
    expect(screen.queryByText('Sensor.Value')).toBeNull()
  })

  it('switching back to Text restores the last number', () => {
    const onChange = vi.fn()
    render(<Host initial={[acquireSlots]} onChange={onChange} />)
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Count' }), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Source' }))
    fireEvent.change(screen.getByPlaceholderText(PICKER), { target: { value: 'flowIn' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Text' }))
    expect((screen.getByRole('spinbutton', { name: 'Count' }) as HTMLInputElement).value).toBe('7')
    expect(onChange).toHaveBeenLastCalledWith([
      { ...acquireSlots, count: 7, countValueType: 'literal', countProperty: 'flowIn' },
    ])
  })

  it('leaves non-count resources unchanged: fixed "Count: 1", no Text/Source', () => {
    render(<Host initial={[{ ...acquireSlots, resourceName: 'Mutex', count: 1 }]} />)
    const row = screen.getByText('Count: 1')
    expect(row).toBeTruthy()
    expect(screen.queryByRole('radio')).toBeNull()
    expect(within(document.body).queryByRole('spinbutton')).toBeNull()
  })
})
