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

import { useCallback } from 'react'
import { useReactFlow } from '@xyflow/react'
import dagre from 'dagre'
import { useFlowStore } from '@/stores/flowStore'
import { useNotationStore, getLayoutDirection } from '@/stores/notationStore'
import type { WorkflowNode, NodeType } from '@/types/nodes'
import type { Edge } from '@xyflow/react'
import type { LayoutDirection } from '@/types/notation'

/**
 * Get node dimensions based on type and notation.
 * Different notations have different node sizes.
 */
export function getNodeDimensions(
  type: NodeType,
  notation: 'flowchart' | 'bpmn' | 'isa88',
): { width: number; height: number } {
  // ISA 88 dimensions
  if (notation === 'isa88') {
    if (type === 'select1' || type === 'waitAny' || type === 'parallel' || type === 'waitAll') {
      return { width: 60, height: 30 }
    }
    if (type === 'start' || type === 'end' || type === 'catch' || type === 'return') {
      return { width: 30, height: 30 }
    }
    if (type === 'gateStep') {
      return { width: 60, height: 24 }
    }
    return { width: 130, height: 50 }
  }

  // BPMN dimensions
  if (notation === 'bpmn') {
    if (type === 'start' || type === 'end' || type === 'catch' || type === 'return') {
      return { width: 30, height: 30 }
    }
    if (type === 'select1' || type === 'waitAny' || type === 'parallel' || type === 'waitAll' || type === 'gateStep') {
      return { width: 40, height: 50 }
    }
    return { width: 140, height: 60 }
  }

  // Flowchart dimensions
  switch (type) {
    case 'start':
    case 'end':
    case 'catch':
    case 'return':
      return { width: 30, height: 30 }
    case 'select1':
    case 'waitAny':
    case 'parallel':
    case 'waitAll':
    case 'gateStep':
      return { width: 60, height: 60 }
    default:
      return { width: 120, height: 50 }
  }
}

/**
 * Apply dagre layout to nodes with notation-aware direction and sizing.
 */
function layoutNodes(
  nodes: WorkflowNode[],
  edges: Edge[],
  direction: LayoutDirection,
  notation: 'flowchart' | 'bpmn' | 'isa88',
): WorkflowNode[] {
  const dagreGraph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}))

  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: 30,
    ranksep: 50,
    marginx: 10,
    marginy: 10,
  })

  // Add nodes with notation-specific dimensions
  nodes.forEach((node) => {
    const { width, height } = getNodeDimensions(node.type as NodeType, notation)
    dagreGraph.setNode(node.id, { width, height })
  })

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target)
  })

  dagre.layout(dagreGraph)

  // Map back with updated positions and handle positions
  return nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id)
    const { width, height } = getNodeDimensions(node.type as NodeType, notation)

    // Snap center to 5px grid, then offset to top-left for correct alignment
    const cx = Math.round(nodeWithPosition.x / 5) * 5
    const cy = Math.round(nodeWithPosition.y / 5) * 5
    return {
      ...node,
      position: {
        x: cx - width / 2,
        y: cy - height / 2,
      },
    }
  })
}

/**
 * Hook for auto-layout functionality with notation awareness.
 *
 * @returns Object with applyLayout function
 */
export function useAutoLayout() {
  const { fitView } = useReactFlow()
  const setNodes = useFlowStore((state) => state.setNodes)
  const notation = useNotationStore((state) => state.notation)

  const applyLayout = useCallback(
    (direction?: LayoutDirection) => {
      const nodes = useFlowStore.getState().nodes
      const edges = useFlowStore.getState().edges

      if (nodes.length === 0) return

      // Use provided direction or derive from current notation
      const layoutDirection = direction ?? getLayoutDirection(notation)
      const layoutedNodes = layoutNodes(nodes, edges, layoutDirection, notation)
      setNodes(layoutedNodes)

      // Fit view after layout with animation
      window.requestAnimationFrame(() => {
        fitView({ padding: 0.1, duration: 200 })
      })
    },
    [setNodes, fitView, notation],
  )

  return { applyLayout }
}
