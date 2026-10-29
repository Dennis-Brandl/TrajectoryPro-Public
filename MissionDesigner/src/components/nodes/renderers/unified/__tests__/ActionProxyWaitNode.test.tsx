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

import { act, render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { describe, it, expect, beforeEach } from 'vitest'
import ActionProxyWaitNode from '../ActionProxyWaitNode'
import { useNotationStore } from '@/stores/notationStore'
import { useLibraryStore } from '@/stores/libraryStore'
import type { Library, Specification } from '@/types/library'
import type { StepNodeData } from '@/types/nodes'

function renderNode(actionName?: string) {
  return render(
    <ReactFlowProvider>
      <ActionProxyWaitNode
        id="a1"
        type="actionProxyWait"
        selected={false}
        dragging={false}
        draggable={true}
        selectable={true}
        deletable={true}
        zIndex={0}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        data={{ label: 'Heat Reactor', stepType: 'actionProxyWait', actionName }}
      />
    </ReactFlowProvider>,
  )
}

describe('ActionProxyWaitNode', () => {
  beforeEach(() => useNotationStore.setState({ notation: 'flowchart' }))

  it('renders the label', () => {
    const { getByText } = renderNode()
    expect(getByText('Heat Reactor')).toBeTruthy()
  })

  it('shows an amber gear while no action is configured', () => {
    const { getByTestId } = renderNode()
    const gear = getByTestId('env-action-gear')
    expect(gear.classList.contains('text-amber-500')).toBe(true)
    expect(gear.classList.contains('text-slate-500')).toBe(false)
  })

  it('shows a slate gear once an action is configured', () => {
    const { getByTestId } = renderNode('heat-reactor')
    const gear = getByTestId('env-action-gear')
    expect(gear.classList.contains('text-slate-500')).toBe(true)
    expect(gear.classList.contains('text-amber-500')).toBe(false)
  })

  it('keeps the gear across notations', () => {
    for (const notation of ['flowchart', 'bpmn', 'isa88'] as const) {
      useNotationStore.setState({ notation })
      const { getByTestId, unmount } = renderNode()
      expect(getByTestId('env-action-gear')).toBeTruthy()
      unmount()
    }
  })
})

function renderWithData(data: StepNodeData) {
  return render(
    <ReactFlowProvider>
      <ActionProxyWaitNode
        id="a1"
        type="actionProxyWait"
        selected={false}
        dragging={false}
        draggable
        selectable
        deletable
        zIndex={0}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        data={data}
      />
    </ReactFlowProvider>,
  )
}

const spec = (id: string, libraryId: string, name: string, data: Record<string, unknown>): Specification =>
  ({
    id,
    libraryId,
    name,
    version: '1.0.0',
    state: 'Draft',
    data,
    history: [],
    createdAt: 0,
    updatedAt: 0,
  }) as unknown as Specification

function seedAction(outputs: Array<{ id: string; name: string }>) {
  useLibraryStore.setState({
    libraries: [
      { id: 'wf-lib-1', name: 'Workflows', entityType: 'workflow' } as unknown as Library,
      { id: 'action-lib-1', name: 'Kitchen Actions', entityType: 'action' } as unknown as Library,
      { id: 'env-lib-1', name: 'Environments', entityType: 'environment' } as unknown as Library,
    ],
    selectedLibraryId: 'wf-lib-1',
    selectedSpecificationId: 'wf-1',
    specifications: new Map([
      ['wf-lib-1', [spec('wf-1', 'wf-lib-1', 'WF', { environmentSpecIds: ['env-1'] })]],
      ['action-lib-1', [spec('act-1', 'action-lib-1', 'PreheatOven', { inputs: [], outputs })]],
      [
        'env-lib-1',
        [
          spec('env-1', 'env-lib-1', 'Kitchen', {
            included_actions: [{ action_name: 'PreheatOven', action_library: 'Kitchen Actions' }],
          }),
        ],
      ],
    ]),
  })
}

describe('ActionProxyWaitNode — outdated-action badge (spec 2026-09-04 §6.4.1)', () => {
  const base: StepNodeData = {
    label: 'Run PreheatOven',
    stepType: 'actionProxyWait',
    actionName: 'PreheatOven',
    actionLibraryName: 'Kitchen Actions',
    inputs: [],
    outputs: [],
  }

  it('shows the badge when the action gained an output the node lacks', () => {
    seedAction([{ id: 'o1', name: 'reached' }])
    const { getByTestId } = renderWithData(base)
    const badge = getByTestId('env-action-outdated')
    expect(badge.getAttribute('title')).toBe('Action definition changed — open the step to update')
  })

  it('no badge when synced, unresolved, or unconfigured', () => {
    seedAction([])
    expect(renderWithData(base).queryByTestId('env-action-outdated')).toBeNull()
    act(() => useLibraryStore.setState({ specifications: new Map() }))
    expect(renderWithData(base).queryByTestId('env-action-outdated')).toBeNull()
    expect(
      renderWithData({ label: 'Heat', stepType: 'actionProxyWait' }).queryByTestId('env-action-outdated'),
    ).toBeNull()
  })
})
