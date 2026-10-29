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
import { Select1StepConfig } from '@/components/properties/Select1StepConfig'
import { useFlowStore } from '@/stores/flowStore'
import { useLibraryStore } from '@/stores/libraryStore'
import type { WorkflowNode, ParameterSpec, StepNodeData, Select1OptionSpec } from '@/types/nodes'

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

function openDropdown(button: HTMLElement) {
  fireEvent.pointerDown(button, { button: 0, ctrlKey: false })
  fireEvent.click(button)
}

describe('Select1StepConfig — Input Parameter Name Source picker', () => {
  it('lists step output parameters under a Step: <label> group when Source is active', () => {
    useFlowStore.setState({
      nodes: [makeNode('upstream', 'Upstream Step', [makeParam('result')])],
    })

    const data: StepNodeData = {
      label: 'Select 1',
      stepType: 'select1',
      select1InputName: '',
      select1InputValueType: 'property',
      select1Options: [],
    }

    render(<Select1StepConfig data={data} nodeId="select-node" onChange={vi.fn()} />)

    // The Input Parameter Name input is the first ValuePropertyInput; its
    // dropdown trigger is the chevron button immediately following it.
    const triggers = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-haspopup') === 'menu')
    expect(triggers.length).toBeGreaterThanOrEqual(1)
    openDropdown(triggers[0])

    // getByText throws if not found, so a successful return is the assertion.
    expect(screen.getByText('Step: Upstream Step')).toBeTruthy()
    expect(screen.getByText('result')).toBeTruthy()
  })

  it('writes the picked output name as a flat string into select1InputName', () => {
    useFlowStore.setState({
      nodes: [makeNode('upstream', 'Upstream Step', [makeParam('result')])],
    })

    const onChange = vi.fn()
    const data: StepNodeData = {
      label: 'Select 1',
      stepType: 'select1',
      select1InputName: '',
      select1InputValueType: 'property',
      select1Options: [],
    }

    render(<Select1StepConfig data={data} nodeId="select-node" onChange={onChange} />)

    const triggers = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-haspopup') === 'menu')
    openDropdown(triggers[0])

    fireEvent.click(screen.getByText('result'))

    expect(onChange).toHaveBeenCalledWith({ select1InputName: 'result' })
  })

  it("offers the step's own Input Parameters for the compare input, but not in the option pickers (spec 2026-09-04 §5.2.4)", () => {
    useFlowStore.setState({
      nodes: [
        {
          id: 'select-node',
          type: 'select1',
          position: { x: 0, y: 0 },
          data: { label: 'Select 1', stepType: 'select1', inputs: [makeParam('level')] },
        } as unknown as WorkflowNode,
      ],
    })
    const option: Select1OptionSpec = {
      id: 'opt-1',
      label: 'Option 1',
      operator: '==',
      value: '',
      valueType: 'property',
      isDefault: false,
    }
    const data: StepNodeData = {
      label: 'Select 1',
      stepType: 'select1',
      select1InputName: '',
      select1InputValueType: 'property',
      select1Options: [option],
    }
    render(<Select1StepConfig data={data} nodeId="select-node" onChange={vi.fn()} />)
    const triggers = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-haspopup') === 'menu')
    expect(triggers.length).toBe(2)
    // First chevron = the compare-input picker (rendered above the options).
    openDropdown(triggers[0])
    expect(screen.getByText('Step Input Parameters')).toBeTruthy()
    expect(screen.getByText('level')).toBeTruthy()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    // Second chevron = the option value picker: no own-inputs group.
    openDropdown(triggers[1])
    expect(screen.queryByText('Step Input Parameters')).toBeNull()
  })
})

describe('Select1StepConfig — Option comparison value Source picker', () => {
  it('lists step output parameters in the option comparison value dropdown when valueType is property', () => {
    useFlowStore.setState({
      nodes: [makeNode('upstream', 'Upstream Step', [makeParam('result')])],
    })

    const option: Select1OptionSpec = {
      id: 'opt-1',
      label: 'Option 1',
      operator: '==',
      value: '',
      valueType: 'property',
      isDefault: false,
    }

    const data: StepNodeData = {
      label: 'Select 1',
      stepType: 'select1',
      select1InputName: 'someInput',
      select1InputValueType: 'literal',
      select1Options: [option],
    }

    render(<Select1StepConfig data={data} nodeId="select-node" onChange={vi.fn()} />)

    // The per-option dropdown trigger is the chevron next to the option's
    // value input. Locate by aria-haspopup attribute.
    const triggers = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-haspopup') === 'menu')
    expect(triggers.length).toBeGreaterThanOrEqual(1)
    // The top-level Input Parameter Name is in literal mode here, so the
    // only chevron belongs to the option picker.
    openDropdown(triggers[0])

    expect(screen.getByText('Step: Upstream Step')).toBeTruthy()
    expect(screen.getByText('result')).toBeTruthy()
  })

  it('writes the picked output name into the option value via onChange', () => {
    useFlowStore.setState({
      nodes: [makeNode('upstream', 'Upstream Step', [makeParam('result')])],
    })

    const option: Select1OptionSpec = {
      id: 'opt-1',
      label: 'Option 1',
      operator: '==',
      value: '',
      valueType: 'property',
      isDefault: false,
    }

    const onChange = vi.fn()
    const data: StepNodeData = {
      label: 'Select 1',
      stepType: 'select1',
      select1InputName: 'someInput',
      select1InputValueType: 'literal',
      select1Options: [option],
    }

    render(<Select1StepConfig data={data} nodeId="select-node" onChange={onChange} />)

    const triggers = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-haspopup') === 'menu')
    openDropdown(triggers[0])
    fireEvent.click(screen.getByText('result'))

    // onChange is fired with select1Options where the option's value is 'result'
    const calls = onChange.mock.calls
    const lastCall = calls[calls.length - 1][0] as { select1Options?: Select1OptionSpec[] }
    expect(lastCall.select1Options).toBeDefined()
    expect(lastCall.select1Options![0].value).toBe('result')
  })
})
