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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { WorkflowNode } from '@/types/nodes'
import type { FormDocument } from '@mission/form-schema'
import { generateOID, WORKER_STEP } from '@/lib/snowflake'
import { cloneFormDocument } from '@/lib/form-document/clone-document'
import { useCopyPaste } from '@/hooks/useCopyPaste'
import { useFlowStore } from '@/stores/flowStore'
import { useFormDocumentStore } from '@/stores/formDocumentStore'

/**
 * Simulates the paste transformation logic from useCopyPaste hook.
 * Replicates what the hook does when pasting nodes.
 */
function simulatePaste(node: WorkflowNode): WorkflowNode {
  let updatedData = { ...node.data }

  // v2 form document — real useCopyPaste routes paste through cloneStepData, which
  // calls cloneFormDocument for fresh section/row/block ids and image imageOids.
  if (updatedData.formDocument) {
    updatedData = { ...updatedData, formDocument: cloneFormDocument(updatedData.formDocument as FormDocument) }
  }

  return {
    ...node,
    id: generateOID(WORKER_STEP),
    data: updatedData,
    position: { x: node.position.x + 20, y: node.position.y + 20 },
    selected: true,
  }
}

/**
 * Helper function to check if a node has non-default content.
 * Replicates the hasNonDefaultContent logic from useCopyPaste hook.
 */
function hasNonDefaultContent(node: WorkflowNode): boolean {
  const data = node.data

  // Check for inputs, outputs, or values
  if (data.inputs && Array.isArray(data.inputs) && data.inputs.length > 0) {
    return true
  }
  if (data.outputs && Array.isArray(data.outputs) && data.outputs.length > 0) {
    return true
  }
  if (data.values && Array.isArray(data.values) && data.values.length > 0) {
    return true
  }

  return false
}

describe('Copy/Paste ID Regeneration', () => {
  describe('Yes/No Step', () => {
    it('preserves all yesNo config fields on paste', () => {
      const originalNode: WorkflowNode = {
        id: 'node-1',
        type: 'yesNoStep',
        position: { x: 0, y: 0 },
        data: {
          label: 'Test',
          stepType: 'yesNoStep',
          yesNoYesLabel: 'Accept',
          yesNoNoLabel: 'Reject',
          yesNoYesValue: 'accepted',
          yesNoNoValue: 'rejected',
          yesNoDefaultSelection: 'yes',
        },
      }

      const pastedNode = simulatePaste(originalNode)

      expect(pastedNode.data.yesNoYesLabel).toBe('Accept')
      expect(pastedNode.data.yesNoNoLabel).toBe('Reject')
      expect(pastedNode.data.yesNoYesValue).toBe('accepted')
      expect(pastedNode.data.yesNoNoValue).toBe('rejected')
      expect(pastedNode.data.yesNoDefaultSelection).toBe('yes')
    })

    it('preserves outputParameterName on paste', () => {
      const originalNode: WorkflowNode = {
        id: 'node-1',
        type: 'yesNoStep',
        position: { x: 0, y: 0 },
        data: {
          label: 'Test',
          stepType: 'yesNoStep',
          outputParameterName: 'userChoice',
        },
      }

      const pastedNode = simulatePaste(originalNode)

      expect(pastedNode.data.outputParameterName).toBe('userChoice')
    })
  })

  describe('Form Entry Step (formDocument v2)', () => {
    it('regenerates formDocument block ids on paste (paste routes through cloneStepData)', () => {
      const originalNode: WorkflowNode = {
        id: 'node-1',
        type: 'userInteractionStep',
        position: { x: 0, y: 0 },
        data: {
          label: 'Test',
          stepType: 'userInteractionStep',
          formDocument: {
            version: 2,
            sections: [
              {
                id: 'sec-1',
                role: 'content',
                rows: [
                  {
                    id: 'row-1',
                    blocks: [{ id: 'block-1', type: 'textInput', fieldName: 'Text_abc123', label: 'Name' }],
                  },
                ],
              },
            ],
          } as FormDocument,
        },
      }

      const pastedNode = simulatePaste(originalNode)
      const pastedDoc = pastedNode.data.formDocument as FormDocument

      // Block id should be regenerated
      expect(pastedDoc.sections[0].rows[0].blocks[0].id).not.toBe('block-1')
      // fieldName should be preserved (v1 cloneFormLayouts parity — the field keeps its identity)
      expect((pastedDoc.sections[0].rows[0].blocks[0] as { fieldName: string }).fieldName).toBe('Text_abc123')
      // formDocument should be a different object (deep clone)
      expect(pastedNode.data.formDocument).not.toBe(originalNode.data.formDocument)
    })
  })

  describe('Delete confirmation', () => {
    beforeEach(() => {
      vi.restoreAllMocks()
    })

    it('identifies node with inputs configured as having non-default content', () => {
      const node: WorkflowNode = {
        id: 'node-1',
        type: 'actionProxyWait',
        position: { x: 0, y: 0 },
        data: {
          label: 'Test',
          stepType: 'actionProxyWait',
          inputs: [{ id: 'in-1', name: 'param1', value: '' }],
        },
      }

      expect(hasNonDefaultContent(node)).toBe(true)
    })

    it('identifies unconfigured node as not having non-default content', () => {
      const node: WorkflowNode = {
        id: 'node-1',
        type: 'actionProxyWait',
        position: { x: 0, y: 0 },
        data: {
          label: 'Test',
          stepType: 'actionProxyWait',
        },
      }

      expect(hasNonDefaultContent(node)).toBe(false)
    })
  })
})

describe('Canvas copy suppression while the v2 form designer is open', () => {
  // Exercises the REAL useCopyPaste hook (not a hand-replica): renders the hook via
  // renderHook so its document-level 'copy' listener is actually attached, then
  // dispatches a real DOM event so that listener actually runs. jsdom does not
  // implement `ClipboardEvent`/`DataTransfer` as constructors, so a plain `Event` is
  // used with a minimal fake `clipboardData` stand-in (just enough surface — `setData`
  // — for the hook's `event.clipboardData?.setData(...)` call).
  const selectedNode: WorkflowNode = {
    id: 'node-1',
    type: 'actionProxyWait',
    position: { x: 0, y: 0 },
    selected: true,
    data: { label: 'Test', stepType: 'actionProxyWait' },
  }

  beforeEach(() => {
    // A selected node is required: with none selected, onCopy returns early
    // regardless of the designer-open guard, which would make the suppression
    // test pass vacuously (for the wrong reason).
    useFlowStore.setState({ nodes: [selectedNode], edges: [] })
  })

  afterEach(() => {
    useFlowStore.setState({ nodes: [], edges: [] })
    useFormDocumentStore.setState({ openNodeId: null } as never)
  })

  function dispatchFakeCopy(): { setData: ReturnType<typeof vi.fn>; defaultPrevented: boolean } {
    const setData = vi.fn()
    const event = new Event('copy', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: { setData }, configurable: true })
    document.dispatchEvent(event)
    return { setData, defaultPrevented: event.defaultPrevented }
  }

  it('suppresses canvas copy while the v2 form designer is open', () => {
    useFormDocumentStore.setState({ openNodeId: 'some-node' } as never)
    renderHook(() => useCopyPaste())

    const { setData, defaultPrevented } = dispatchFakeCopy()

    // No-op: the guard must return before writing the clipboard or preventing default.
    expect(setData).not.toHaveBeenCalled()
    expect(defaultPrevented).toBe(false)
  })

  it('does not suppress canvas copy when the v2 form designer is closed (control)', () => {
    useFormDocumentStore.setState({ openNodeId: null } as never)
    renderHook(() => useCopyPaste())

    const { setData, defaultPrevented } = dispatchFakeCopy()

    // Sanity check for the harness itself: proves dispatchFakeCopy really reaches the
    // real onCopy body (and that it writes clipboard data) when nothing suppresses it —
    // so the suppression test above isn't just failing to exercise the code at all.
    expect(setData).toHaveBeenCalledTimes(1)
    expect(defaultPrevented).toBe(true)
  })
})
