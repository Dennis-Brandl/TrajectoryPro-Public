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
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { NodeInlineEditor } from '../NodeInlineEditor'
import { useFlowStore } from '@/stores/flowStore'
import { useLibraryStore } from '@/stores/libraryStore'
import type { Library, Specification } from '@/types/library'
import type { StepNodeData, WorkflowNode } from '@/types/nodes'

vi.mock('../ScriptEditorModal', () => ({ ScriptEditorModal: () => null }))

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

const base: StepNodeData = {
  label: 'Run PreheatOven',
  stepType: 'actionProxyWait',
  actionName: 'PreheatOven',
  actionLibraryName: 'Kitchen Actions',
  inputs: [{ id: 'p1', name: 'target_temp_c', description: '', value: '180', valueType: 'literal' }],
  outputs: [],
  actionProxyConfig: { action_oid: 'act-1', environment_oid: 'env-1' },
}

beforeEach(() => {
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
      [
        'action-lib-1',
        [
          spec('act-1', 'action-lib-1', 'PreheatOven', {
            inputs: [{ id: 'p1', name: 'target_temp_c', description: '' }],
            outputs: [{ id: 'o1', name: 'reached', description: '' }],
          }),
        ],
      ],
      [
        'env-lib-1',
        [
          spec('env-1', 'env-lib-1', 'Kitchen', {
            included_actions: [{ action_name: 'PreheatOven', action_library: 'Kitchen Actions' }],
          }),
        ],
      ],
    ]),
    fetchSpecifications: vi.fn(async () => {}),
  })
  const node = { id: 'n1', type: 'actionProxyWait', position: { x: 0, y: 0 }, data: base } as WorkflowNode
  useFlowStore.setState({ nodes: [node], edges: [], nodeDataRevision: 0, hydratedSpecId: null })
})

function renderPanel(data: StepNodeData = base) {
  return render(
    <ReactFlowProvider>
      <NodeInlineEditor
        nodeType="actionProxyWait"
        nodeId="n1"
        initialData={data}
        initialChildData={null}
        isEmbeddedSubWorkflow={false}
        isReferencedSubWorkflow={false}
      />
    </ReactFlowProvider>,
  )
}

describe('NodeInlineEditor - Time limit (seconds)', () => {
  it('typing a time limit writes timeout_ms through the autosave', async () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText('Time limit (seconds)'), { target: { value: '45' } })
    await waitFor(
      () => expect((useFlowStore.getState().nodes[0].data as StepNodeData).actionProxyConfig?.timeout_ms).toBe(45000),
      { timeout: 1500 },
    )
  })

  it('clearing it removes the key', async () => {
    const withLimit: StepNodeData = {
      ...base,
      actionProxyConfig: { action_oid: 'act-1', environment_oid: 'env-1', timeout_ms: 30000 },
    }
    useFlowStore.setState({
      nodes: [{ id: 'n1', type: 'actionProxyWait', position: { x: 0, y: 0 }, data: withLimit } as WorkflowNode],
    })
    renderPanel(withLimit)
    fireEvent.change(screen.getByLabelText('Time limit (seconds)'), { target: { value: '' } })
    await waitFor(
      () =>
        expect('timeout_ms' in ((useFlowStore.getState().nodes[0].data as StepNodeData).actionProxyConfig ?? {})).toBe(
          false,
        ),
      { timeout: 1500 },
    )
  })
})
