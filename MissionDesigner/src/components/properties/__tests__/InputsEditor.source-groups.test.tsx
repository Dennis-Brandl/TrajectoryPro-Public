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

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InputsEditor } from '@/components/properties/InputsEditor'
import { useFlowStore } from '@/stores/flowStore'
import { useLibraryStore } from '@/stores/libraryStore'
import type { WorkflowNode, ParameterSpec } from '@/types/nodes'
import type { Specification } from '@/types/library'

function makeNode(id: string, label: string, outputs?: ParameterSpec[]): WorkflowNode {
  return {
    id,
    type: 'actionProxyWait',
    position: { x: 0, y: 0 },
    data: { label, stepType: 'actionProxyWait', outputs },
  }
}

function makeParam(name: string): ParameterSpec {
  return { id: `p-${name}`, name, description: '' }
}

beforeEach(() => {
  useFlowStore.setState({
    nodes: [],
    edges: [],
    workflowInputs: [],
    workflowOutputs: [],
    workflowValues: [],
    workflowResources: [],
    hasDraft: false,
    editDialogRequest: null,
    _showLegacyUpgradeNotice: false,
    propertiesPanelWidth: 280,
  })
  useFlowStore.temporal.getState().clear()
  useLibraryStore.setState({ specifications: new Map(), selectedSpecificationId: null })
})

/** The ▾ button beside each Source field that shows the whole suggestion list. */
function sourceToggles() {
  return screen.getAllByRole('button', { name: 'Show sources' })
}

function openDropdown(button: HTMLElement) {
  fireEvent.click(button)
}

describe('InputsEditor Source dropdown groups', () => {
  it('shows workflow inputs/outputs and step-output groups in canonical order', () => {
    useFlowStore.setState({
      nodes: [makeNode('upstream', 'Upstream Step', [makeParam('upstreamOut')])],
      workflowInputs: [makeParam('flowIn')],
      workflowOutputs: [makeParam('flowOut')],
    })

    const inputs: ParameterSpec[] = [{ id: 'i1', name: 'in1', valueType: 'property', value: '', description: '' }]

    render(<InputsEditor inputs={inputs} onChange={vi.fn()} nodeId="self" />)

    // Open the ValuePropertyInput suggestion list for the first input row.
    const triggers = sourceToggles()
    expect(triggers.length).toBeGreaterThanOrEqual(1)
    openDropdown(triggers[0])

    // Group labels should appear in canonical order
    const labels = screen
      .getAllByText(
        /Workflow Input Parameters|Workflow Output Parameters|Parent Output Parameters|Parent Input Parameters|Step: /,
      )
      .map((el) => el.textContent)

    // Only three of the five categories are populated here
    expect(labels).toEqual(['Workflow Input Parameters', 'Workflow Output Parameters', 'Step: Upstream Step'])
  })
})

function seedEnvWithActionProperties() {
  const env = {
    id: 'env-1',
    libraryId: 'lib-env',
    name: 'Kitchen',
    description: null,
    version: '1.0.0',
    state: 'Draft',
    data: {
      actionProperties: [
        {
          id: 'ap-1',
          name: 'Sensor',
          entries: [
            { id: 'e1', name: 'Value', value: '' },
            { id: 'e2', name: 'Description', value: '' },
          ],
        },
      ],
    },
    history: [],
    createdAt: 0,
    updatedAt: 0,
  } as Specification
  const wf = {
    ...env,
    id: 'wf-1',
    libraryId: 'lib-wf',
    name: 'Flow',
    data: { environmentSpecIds: ['env-1'] },
  } as Specification
  useLibraryStore.setState({
    specifications: new Map([
      ['lib-env', [env]],
      ['lib-wf', [wf]],
    ]),
    selectedSpecificationId: 'wf-1',
  })
}

describe('InputsEditor Source dropdown — Action Properties (spec 2026-09-04 §5.2)', () => {
  const inputs: ParameterSpec[] = [{ id: 'i1', name: 'in1', valueType: 'property', value: '', description: '' }]

  it('lists environment Action Properties (group + Group.Entry, Description hidden) when includeActionProperties is set', () => {
    seedEnvWithActionProperties()
    render(<InputsEditor inputs={inputs} onChange={vi.fn()} nodeId="self" includeActionProperties />)
    const triggers = sourceToggles()
    openDropdown(triggers[0])
    expect(screen.getByText('Env: Kitchen (Action Properties)')).toBeTruthy()
    expect(screen.getByText('Sensor')).toBeTruthy()
    expect(screen.getByText('Sensor.Value')).toBeTruthy()
    expect(screen.queryByText(/Sensor\.Description/)).toBeNull()
  })

  it('omits them without the prop', () => {
    seedEnvWithActionProperties()
    render(<InputsEditor inputs={inputs} onChange={vi.fn()} nodeId="self" />)
    const triggers = sourceToggles()
    // With nothing else to offer the trigger is disabled — the dropdown has no action-property groups.
    expect(triggers[0].hasAttribute('disabled')).toBe(true)
    expect(screen.queryByText('Env: Kitchen (Action Properties)')).toBeNull()
  })

  it('selecting an entry writes the dotted ref through onChange', () => {
    seedEnvWithActionProperties()
    const onChange = vi.fn()
    render(<InputsEditor inputs={inputs} onChange={onChange} nodeId="self" includeActionProperties />)
    const triggers = sourceToggles()
    openDropdown(triggers[0])
    fireEvent.click(screen.getByText('Sensor.Value'))
    expect(onChange).toHaveBeenCalledWith([{ ...inputs[0], value: 'Sensor.Value' }])
  })
})

describe('InputsEditor Source field — filter as you type', () => {
  const inputs: ParameterSpec[] = [{ id: 'i1', name: 'in1', valueType: 'property', value: '', description: '' }]

  it('typing filters the suggestions (case-insensitive substring) and keeps the typed text', () => {
    useFlowStore.setState({ workflowInputs: [makeParam('flowTemperature'), makeParam('flowPressure')] })
    const onChange = vi.fn()
    render(<InputsEditor inputs={inputs} onChange={onChange} nodeId="self" />)
    const field = screen.getByRole('combobox')
    fireEvent.change(field, { target: { value: 'TEMP' } })
    expect(onChange).toHaveBeenCalledWith([{ ...inputs[0], value: 'TEMP' }])
    expect(screen.getByText('flowTemperature')).toBeTruthy()
    expect(screen.queryByText('flowPressure')).toBeNull()
  })

  it('hides the list when nothing matches (free text is still allowed)', () => {
    useFlowStore.setState({ workflowInputs: [makeParam('flowTemperature')] })
    render(<InputsEditor inputs={inputs} onChange={vi.fn()} nodeId="self" />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzz' } })
    expect(screen.queryByText('Workflow Input Parameters')).toBeNull()
  })
})
