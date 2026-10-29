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
import { useFlowStore } from '@/stores/flowStore'
import type { WorkflowNode } from '@/types/nodes'

describe('Undo/Redo for UI Parameter Operations', () => {
  beforeEach(() => {
    // Reset store and clear temporal history
    useFlowStore.setState({ nodes: [], edges: [] })
    useFlowStore.temporal.getState().clear()
  })

  describe('Yes/No Step undo/redo', () => {
    it('undoes changing yesNoYesLabel', () => {
      const node: WorkflowNode = {
        id: 'node-1',
        type: 'yesNoStep',
        position: { x: 0, y: 0 },
        data: {
          label: 'Test',
          stepType: 'yesNoStep',
          yesNoYesLabel: 'Original Yes',
        },
      }
      useFlowStore.setState({ nodes: [node] })
      useFlowStore.temporal.getState().clear()

      // Change yes label
      useFlowStore.getState().updateNodeData('node-1', {
        yesNoYesLabel: 'Modified Yes',
      })

      expect(useFlowStore.getState().nodes[0].data.yesNoYesLabel).toBe('Modified Yes')

      // Undo
      useFlowStore.temporal.getState().undo()
      expect(useFlowStore.getState().nodes[0].data.yesNoYesLabel).toBe('Original Yes')
    })

    it('undoes changing yesNoDefaultSelection', () => {
      const node: WorkflowNode = {
        id: 'node-1',
        type: 'yesNoStep',
        position: { x: 0, y: 0 },
        data: {
          label: 'Test',
          stepType: 'yesNoStep',
          yesNoDefaultSelection: 'none',
        },
      }
      useFlowStore.setState({ nodes: [node] })
      useFlowStore.temporal.getState().clear()

      // Change default selection
      useFlowStore.getState().updateNodeData('node-1', {
        yesNoDefaultSelection: 'yes',
      })

      expect(useFlowStore.getState().nodes[0].data.yesNoDefaultSelection).toBe('yes')

      // Undo
      useFlowStore.temporal.getState().undo()
      expect(useFlowStore.getState().nodes[0].data.yesNoDefaultSelection).toBe('none')
    })
  })
})
