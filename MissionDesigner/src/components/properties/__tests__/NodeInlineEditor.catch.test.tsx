// @vitest-environment jsdom
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

import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { NodeInlineEditor } from '../NodeInlineEditor'
import { useFlowStore } from '@/stores/flowStore'
import type { WorkflowNode } from '@/types/nodes'

const baseProps = {
  nodeType: 'catch' as const,
  initialChildData: null,
  isEmbeddedSubWorkflow: false,
  isReferencedSubWorkflow: false,
}

function renderCatchPanel() {
  return render(
    <ReactFlowProvider>
      <NodeInlineEditor
        {...baseProps}
        nodeId="c1"
        initialData={{ label: 'Recover', stepType: 'catch', catchId: 'C1' }}
      />
    </ReactFlowProvider>,
  )
}

describe('NodeInlineEditor — CATCH Triggered by', () => {
  beforeEach(() => {
    useFlowStore.setState({
      edges: [],
      nodes: [
        {
          id: 'c1',
          type: 'catch',
          position: { x: 0, y: 0 },
          data: { label: 'Recover', stepType: 'catch', catchId: 'C1' },
        },
        {
          id: 's2',
          type: 'actionProxyWait',
          position: { x: 0, y: 0 },
          data: {
            label: 'Pump Start',
            stepType: 'actionProxyWait',
            trySpecifications: [{ mode: 'ERROR', catch_id: 'C1' }],
          },
        },
      ] as unknown as WorkflowNode[],
    })
  })

  it('lists the TRY that targets the selected CATCH', () => {
    renderCatchPanel()
    fireEvent.click(screen.getByText('CATCH ID')) // expand the collapsed CATCH ID section
    expect(screen.getByText('Triggered by (1)')).toBeTruthy()
    expect(screen.getByText('Pump Start')).toBeTruthy()
    expect(screen.getByText('ON ERROR')).toBeTruthy()
  })

  it('selects the source step when its row is clicked', () => {
    renderCatchPanel()
    fireEvent.click(screen.getByText('CATCH ID')) // expand the collapsed CATCH ID section
    fireEvent.click(screen.getByText('Pump Start'))
    expect(useFlowStore.getState().nodes.find((n) => n.id === 's2')!.selected).toBe(true)
  })

  it('shows the four canonical outputs read-only, with no add or remove controls', () => {
    renderCatchPanel()
    fireEvent.click(screen.getByText('Output Parameters')) // expand the collapsed outputs section
    for (const name of ['Message', 'Reason', 'Step', 'StepID']) {
      expect(screen.getByText(name)).toBeTruthy()
    }
    expect(screen.queryByRole('button', { name: /Add output parameter/i })).toBeNull()
    expect(screen.queryByPlaceholderText('Parameter name')).toBeNull()
  })
})
