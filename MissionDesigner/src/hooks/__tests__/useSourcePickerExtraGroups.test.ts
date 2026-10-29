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

import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useFlowStore } from '@/stores/flowStore'
import { useLibraryStore } from '@/stores/libraryStore'
import { useSourcePickerExtraGroups } from '@/hooks/useSourcePickerExtraGroups'
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

describe('useSourcePickerExtraGroups', () => {
  it('returns [] for an empty workflow with no parent', () => {
    const { result } = renderHook(() => useSourcePickerExtraGroups())
    expect(result.current).toEqual([])
  })

  it('emits groups in canonical order when all categories are populated', () => {
    useFlowStore.setState({
      nodes: [makeNode('step-A', 'Step A', [makeParam('result')])],
      workflowInputs: [makeParam('flowIn')],
      workflowOutputs: [makeParam('flowOut')],
    })

    const parentSpec: Specification = {
      id: 'parent-id',
      libraryId: 'lib-1',
      name: 'Parent',
      type: 'workflow',
      data: {
        workflowInputs: [makeParam('parentIn')],
        workflowOutputs: [makeParam('parentOut')],
      },
    } as unknown as Specification

    const childSpec: Specification = {
      id: 'child-id',
      libraryId: 'lib-1',
      name: 'Child',
      type: 'workflow',
      data: { parentSpecificationId: 'parent-id' },
    } as unknown as Specification

    useLibraryStore.setState({
      specifications: new Map([['lib-1', [parentSpec, childSpec]]]),
      selectedSpecificationId: 'child-id',
    })

    const { result } = renderHook(() => useSourcePickerExtraGroups())

    expect(result.current.map((g) => g.label)).toEqual([
      'Workflow Input Parameters',
      'Workflow Output Parameters',
      'Parent Output Parameters',
      'Parent Input Parameters',
      'Step: Step A',
    ])
  })

  it('excludes the current node from per-step groups', () => {
    useFlowStore.setState({
      nodes: [makeNode('self', 'Self', [makeParam('selfOut')]), makeNode('other', 'Other', [makeParam('otherOut')])],
    })
    const { result } = renderHook(() => useSourcePickerExtraGroups('self'))
    const stepGroups = result.current.filter((g) => g.label.startsWith('Step:'))
    expect(stepGroups).toHaveLength(1)
    expect(stepGroups[0].label).toBe('Step: Other')
  })

  it('skips steps whose outputs are empty, undefined, or unusable', () => {
    useFlowStore.setState({
      nodes: [
        makeNode('a', 'A', undefined),
        makeNode('b', 'B', []),
        makeNode('c', 'C', [{ id: 'x', name: '', description: '' }]),
        makeNode('d', 'D', [makeParam('keep')]),
      ],
    })
    const { result } = renderHook(() => useSourcePickerExtraGroups())
    const stepGroups = result.current.filter((g) => g.label.startsWith('Step:'))
    expect(stepGroups).toHaveLength(1)
    expect(stepGroups[0].label).toBe('Step: D')
  })

  it('disambiguates catch nodes by appending their catch id to the group label', () => {
    useFlowStore.setState({
      nodes: [
        {
          id: 'catch-1',
          type: 'catch',
          position: { x: 0, y: 0 },
          data: { label: 'CATCH', stepType: 'catch', catchId: 'WF', outputs: [makeParam('Message')] },
        },
        {
          id: 'catch-2',
          type: 'catch',
          position: { x: 0, y: 0 },
          data: { label: 'CATCH', stepType: 'catch', catchId: 'StepErr', outputs: [makeParam('Message')] },
        },
        // A catch with no id yet keeps the bare label rather than "CATCH ()"
        {
          id: 'catch-3',
          type: 'catch',
          position: { x: 0, y: 0 },
          data: { label: 'CATCH', stepType: 'catch', outputs: [makeParam('Message')] },
        },
      ] as unknown as WorkflowNode[],
    })
    const { result } = renderHook(() => useSourcePickerExtraGroups())
    expect(result.current.map((g) => g.label)).toEqual(['Step: CATCH (WF)', 'Step: CATCH (StepErr)', 'Step: CATCH'])
  })

  it('falls back to node id for unlabeled steps and to target for unnamed outputs', () => {
    useFlowStore.setState({
      nodes: [
        {
          id: 'node-99',
          type: 'actionProxyWait',
          position: { x: 0, y: 0 },
          data: {
            label: '',
            stepType: 'actionProxyWait',
            outputs: [{ id: 'o1', name: '', description: '', target: 'someTarget' }],
          },
        },
      ],
    })
    const { result } = renderHook(() => useSourcePickerExtraGroups())
    const group = result.current.find((g) => g.label.startsWith('Step:'))
    expect(group?.label).toBe('Step: node-99')
    expect(group?.items).toEqual([{ value: 'someTarget', display: 'someTarget' }])
  })

  it('omits parent groups when the workflow has no parent', () => {
    useFlowStore.setState({
      workflowInputs: [makeParam('flowIn')],
      workflowOutputs: [makeParam('flowOut')],
    })
    const { result } = renderHook(() => useSourcePickerExtraGroups())
    expect(result.current.map((g) => g.label)).toEqual(['Workflow Input Parameters', 'Workflow Output Parameters'])
  })

  it('prepends "Step Input Parameters" (the current node\'s own named inputs) only when includeOwnInputs is set', () => {
    useFlowStore.setState({
      nodes: [
        {
          id: 'self',
          type: 'select1',
          position: { x: 0, y: 0 },
          data: {
            label: 'Select',
            stepType: 'select1',
            inputs: [makeParam('level'), { id: 'x', name: '', description: '' }],
          },
        } as unknown as WorkflowNode,
        makeNode('other', 'Other', [makeParam('otherOut')]),
      ],
      workflowInputs: [makeParam('flowIn')],
    })
    const withOwn = renderHook(() => useSourcePickerExtraGroups('self', { includeOwnInputs: true })).result.current
    expect(withOwn.map((g) => g.label)).toEqual(['Step Input Parameters', 'Workflow Input Parameters', 'Step: Other'])
    expect(withOwn[0].items).toEqual([{ value: 'level', display: 'level' }])
    const without = renderHook(() => useSourcePickerExtraGroups('self')).result.current
    expect(without.map((g) => g.label)).toEqual(['Workflow Input Parameters', 'Step: Other'])
  })
})
