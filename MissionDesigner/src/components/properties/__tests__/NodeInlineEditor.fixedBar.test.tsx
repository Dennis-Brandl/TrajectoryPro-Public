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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { NodeInlineEditor } from '../NodeInlineEditor'
import { useFlowStore } from '@/stores/flowStore'
import type { StepNodeData, WorkflowNode } from '@/types/nodes'

vi.mock('../ScriptEditorModal', () => ({ ScriptEditorModal: () => null }))
const canEdit = vi.hoisted(() => ({ value: true }))
vi.mock('@/hooks/useCanEditActiveSpec', () => ({ useCanEditActiveSpec: () => canEdit.value }))

const buttonDoc = {
  version: 2,
  sections: [
    {
      id: 's1',
      role: 'content',
      rows: [
        { id: 'r1', blocks: [{ id: 'b1', type: 'button', label: 'Go', outputValue: 'continue', job: 'continue' }] },
      ],
    },
  ],
}

function setup(data: Partial<StepNodeData>, type: 'userInteractionStep' | 'yesNoStep' = 'userInteractionStep') {
  const full = { label: 'U', stepType: type, ...data } as StepNodeData
  useFlowStore.setState({
    nodes: [{ id: 'n1', type, position: { x: 0, y: 0 }, data: full } as unknown as WorkflowNode],
    edges: [],
  })
  return render(
    <ReactFlowProvider>
      <NodeInlineEditor
        nodeType={type}
        nodeId="n1"
        initialData={full}
        initialChildData={null}
        isEmbeddedSubWorkflow={false}
        isReferencedSubWorkflow={false}
      />
    </ReactFlowProvider>,
  )
}
const nodeData = () => useFlowStore.getState().nodes[0].data as StepNodeData

describe('NodeInlineEditor — fixed bar', () => {
  beforeEach(() => {
    canEdit.value = true
  })

  it('switches save allowBack and allowStop', async () => {
    setup({ buttonBar: {}, allowBack: false, allowStop: false })
    fireEvent.click(screen.getByText('Buttons'))
    fireEvent.click(screen.getByLabelText("Allow Back — return to the operator's previous screen"))
    fireEvent.click(screen.getByLabelText('Allow Stop — let the operator stop the whole workflow'))
    await waitFor(() => expect(nodeData().allowBack).toBe(true))
    expect(nodeData().allowStop).toBe(true)
  })

  it('opening a legacy screen step converts it once', () => {
    const { unmount } = setup({ formDocument: buttonDoc as never })
    expect(nodeData().buttonBar).toBeDefined()
    expect(JSON.stringify(nodeData().formDocument)).not.toContain('"button"')
    // Opening again does not convert again (same object kept).
    const before = nodeData()
    unmount()
    render(
      <ReactFlowProvider>
        <NodeInlineEditor
          nodeType="userInteractionStep"
          nodeId="n1"
          initialData={before}
          initialChildData={null}
          isEmbeddedSubWorkflow={false}
          isReferencedSubWorkflow={false}
        />
      </ReactFlowProvider>,
    )
    expect(nodeData()).toBe(before)
  })

  it('keeps a routing problem on the step and shows it', () => {
    const doc = JSON.parse(JSON.stringify(buttonDoc))
    doc.sections[0].rows[0].blocks[0] = { id: 'b1', type: 'button', label: 'Left', outputValue: 'left' }
    const full = { label: 'U', stepType: 'userInteractionStep', formDocument: doc } as StepNodeData
    useFlowStore.setState({
      nodes: [
        { id: 'n1', type: 'userInteractionStep', position: { x: 0, y: 0 }, data: full } as unknown as WorkflowNode,
      ],
      edges: [{ id: 'e', source: 'n1', target: 'x', data: { condition: 'left' } }],
    })
    render(
      <ReactFlowProvider>
        <NodeInlineEditor
          nodeType="userInteractionStep"
          nodeId="n1"
          initialData={full}
          initialChildData={null}
          isEmbeddedSubWorkflow={false}
          isReferencedSubWorkflow={false}
        />
      </ReactFlowProvider>,
    )
    expect(nodeData().routingProblem).toContain('routed on which button')
    expect(nodeData().routingValues).toEqual(['left'])
    fireEvent.click(screen.getByText('Buttons'))
    expect(screen.getByText(/routed on which button/)).toBeTruthy()
  })

  it('converts from the live node, so a step already converted elsewhere is not converted again', () => {
    const full = { label: 'U', stepType: 'userInteractionStep', formDocument: buttonDoc } as unknown as StepNodeData
    const live = { ...full, buttonBar: {}, allowBack: false, allowStop: false } as StepNodeData
    useFlowStore.setState({
      nodes: [
        { id: 'n1', type: 'userInteractionStep', position: { x: 0, y: 0 }, data: live } as unknown as WorkflowNode,
      ],
      edges: [],
    })
    const update = vi.fn()
    useFlowStore.setState({ updateNodeData: update })
    render(
      <ReactFlowProvider>
        <NodeInlineEditor
          nodeType="userInteractionStep"
          nodeId="n1"
          initialData={full}
          initialChildData={null}
          isEmbeddedSubWorkflow={false}
          isReferencedSubWorkflow={false}
        />
      </ReactFlowProvider>,
    )
    expect(update).not.toHaveBeenCalled()
    expect(nodeData()).toBe(live)
  })

  it('does not convert an Effective (read-only) spec', () => {
    canEdit.value = false
    setup({ formDocument: buttonDoc as never })
    expect(nodeData().buttonBar).toBeUndefined()
  })
})
