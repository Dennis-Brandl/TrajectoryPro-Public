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

import { useCallback, useRef, useState } from 'react'
import { useNodeId, useReactFlow } from '@xyflow/react'
import { useFlowStore } from '@/stores/flowStore'
import type { StepNodeData } from '@/types/nodes'

const DEFAULT_ISA88_WIDTH = 90
const MIN_ISA88_WIDTH = 80

export { DEFAULT_ISA88_WIDTH, MIN_ISA88_WIDTH }

/**
 * Hook for ISA88 symmetric horizontal resize behavior on control nodes.
 * Dragging either end resizes both sides equally (bar stays centered).
 * Returns width, xOffset for visual drag feedback, and startResize handler.
 */
export function useIsa88Resize(data: StepNodeData) {
  const nodeId = useNodeId()!
  const { getViewport, getNode } = useReactFlow()

  const storedWidth = (data.isa88Width as number) || DEFAULT_ISA88_WIDTH
  const [dragState, setDragState] = useState<{ width: number; xOffset: number } | null>(null)
  const latestRef = useRef({ width: storedWidth, xOffset: 0 })

  const width = dragState?.width ?? storedWidth
  const xOffset = dragState?.xOffset ?? 0

  const startResize = useCallback(
    (e: React.MouseEvent, side: 'left' | 'right') => {
      e.stopPropagation()
      e.preventDefault()

      const node = getNode(nodeId)
      if (!node) return

      const startWidth = (node.data.isa88Width as number) || DEFAULT_ISA88_WIDTH
      const startNodeX = node.position.x
      const startX = e.clientX

      const onMouseMove = (moveEvent: MouseEvent) => {
        const { zoom } = getViewport()
        const rawDx = (moveEvent.clientX - startX) / zoom
        const dx = side === 'right' ? rawDx : -rawDx
        const newWidth = Math.max(MIN_ISA88_WIDTH, startWidth + dx * 2)
        const halfDelta = (newWidth - startWidth) / 2
        const state = { width: newWidth, xOffset: -halfDelta }
        latestRef.current = state
        setDragState(state)
      }

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)

        const { width: dragWidth } = latestRef.current
        const snapped = Math.round(dragWidth / 5) * 5
        const finalWidth = Math.max(snapped, MIN_ISA88_WIDTH)
        const finalHalfDelta = (finalWidth - startWidth) / 2

        // Commit position + width atomically
        const currentNodes = useFlowStore.getState().nodes
        useFlowStore.getState().setNodes(
          currentNodes.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  position: { ...n.position, x: startNodeX - finalHalfDelta },
                  data: { ...n.data, isa88Width: finalWidth },
                }
              : n,
          ),
        )

        setDragState(null)
        latestRef.current = { width: finalWidth, xOffset: 0 }
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [nodeId, getNode, getViewport],
  )

  return { width, xOffset, startResize }
}
