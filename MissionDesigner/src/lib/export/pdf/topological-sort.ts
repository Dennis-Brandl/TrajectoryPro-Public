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

import type { Edge } from '@xyflow/react'
import type { WorkflowNode } from '@/types/nodes'

/**
 * Topological sort of workflow nodes using BFS (Kahn's algorithm).
 *
 * Orders nodes starting from the START node, following edges in direction.
 * Falls back to zero-in-degree nodes if no START node is present.
 * Any unreachable nodes are appended at the end.
 *
 * @param nodes - All workflow nodes
 * @param edges - All workflow edges
 * @returns Nodes in topological order
 */
export function topologicalSort(nodes: WorkflowNode[], edges: Edge[]): WorkflowNode[] {
  if (nodes.length === 0) return []

  // Build node map for fast lookup
  const nodeMap = new Map<string, WorkflowNode>()
  for (const node of nodes) {
    nodeMap.set(node.id, node)
  }

  // Build adjacency list (source → targets) and in-degree map
  const adjacency = new Map<string, string[]>()
  const inDegree = new Map<string, number>()

  for (const node of nodes) {
    adjacency.set(node.id, [])
    inDegree.set(node.id, 0)
  }

  for (const edge of edges) {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) continue
    adjacency.get(edge.source)!.push(edge.target)
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1)
  }

  // Determine starting nodes
  const queue: string[] = []
  const startNode = nodes.find((n) => n.type === 'start')

  if (startNode) {
    queue.push(startNode.id)
  } else {
    // Fallback: all nodes with zero in-degree
    for (const node of nodes) {
      if ((inDegree.get(node.id) ?? 0) === 0) {
        queue.push(node.id)
      }
    }
  }

  // BFS traversal
  const visited = new Set<string>()
  const result: WorkflowNode[] = []

  while (queue.length > 0) {
    const currentId = queue.shift()!
    if (visited.has(currentId)) continue
    visited.add(currentId)

    const current = nodeMap.get(currentId)
    if (current) result.push(current)

    const neighbors = adjacency.get(currentId) ?? []
    for (const neighborId of neighbors) {
      if (visited.has(neighborId)) continue
      const newInDegree = (inDegree.get(neighborId) ?? 1) - 1
      inDegree.set(neighborId, newInDegree)
      if (newInDegree <= 0) {
        queue.push(neighborId)
      }
    }
  }

  // Append unreachable nodes at the end
  for (const node of nodes) {
    if (!visited.has(node.id)) {
      result.push(node)
    }
  }

  return result
}
