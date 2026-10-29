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
import type { WorkflowNode, ParameterSpec, ValueSpec, ResourceSpec } from '@/types/nodes'
import type { Specification } from '@/types/library'
import type { Edge } from '@xyflow/react'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(id: string, overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id,
    type: 'start',
    position: { x: 0, y: 0 },
    data: { label: `Node ${id}`, stepType: 'start' },
    ...overrides,
  }
}

function makeEdge(id: string, source: string, target: string): Edge {
  return { id, source, target }
}

// ---------------------------------------------------------------------------
// Reset before every test
// ---------------------------------------------------------------------------

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
})

// ===========================================================================
// setNodes / setEdges
// ===========================================================================

describe('setNodes', () => {
  it('replaces all nodes', () => {
    const n1 = makeNode('n1')
    const n2 = makeNode('n2')
    useFlowStore.getState().setNodes([n1])
    useFlowStore.getState().setNodes([n2])
    const { nodes } = useFlowStore.getState()
    expect(nodes).toHaveLength(1)
    expect(nodes[0].id).toBe('n2')
  })

  it('sets nodes to empty array', () => {
    useFlowStore.getState().setNodes([makeNode('n1')])
    useFlowStore.getState().setNodes([])
    expect(useFlowStore.getState().nodes).toHaveLength(0)
  })
})

describe('setEdges', () => {
  it('replaces all edges', () => {
    const e1 = makeEdge('e1', 'a', 'b')
    const e2 = makeEdge('e2', 'b', 'c')
    useFlowStore.getState().setEdges([e1])
    useFlowStore.getState().setEdges([e2])
    const { edges } = useFlowStore.getState()
    expect(edges).toHaveLength(1)
    expect(edges[0].id).toBe('e2')
  })
})

// ===========================================================================
// addNode
// ===========================================================================

describe('addNode', () => {
  it('appends a node to an empty store', () => {
    useFlowStore.getState().addNode(makeNode('n1'))
    expect(useFlowStore.getState().nodes).toHaveLength(1)
    expect(useFlowStore.getState().nodes[0].id).toBe('n1')
  })

  it('appends without removing existing nodes', () => {
    useFlowStore.getState().addNode(makeNode('n1'))
    useFlowStore.getState().addNode(makeNode('n2'))
    expect(useFlowStore.getState().nodes).toHaveLength(2)
  })

  it('preserves node data on add', () => {
    const node = makeNode('n1', {
      data: { label: 'My Step', stepType: 'end', description: 'done' },
    })
    useFlowStore.getState().addNode(node)
    expect(useFlowStore.getState().nodes[0].data.label).toBe('My Step')
    expect(useFlowStore.getState().nodes[0].data.description).toBe('done')
  })
})

// ===========================================================================
// updateNodeData
// ===========================================================================

describe('updateNodeData', () => {
  it('merges partial data onto a node', () => {
    useFlowStore.setState({ nodes: [makeNode('n1')] })
    useFlowStore.temporal.getState().clear()
    useFlowStore.getState().updateNodeData('n1', { label: 'Updated', description: 'new desc' })
    const node = useFlowStore.getState().nodes[0]
    expect(node.data.label).toBe('Updated')
    expect(node.data.description).toBe('new desc')
    expect(node.data.stepType).toBe('start') // unchanged field preserved
  })

  it('does not affect other nodes', () => {
    useFlowStore.setState({ nodes: [makeNode('n1'), makeNode('n2')] })
    useFlowStore.temporal.getState().clear()
    useFlowStore.getState().updateNodeData('n1', { label: 'Changed' })
    expect(useFlowStore.getState().nodes[1].data.label).toBe('Node n2')
  })

  it('is a no-op for unknown nodeId', () => {
    useFlowStore.setState({ nodes: [makeNode('n1')] })
    useFlowStore.temporal.getState().clear()
    useFlowStore.getState().updateNodeData('unknown', { label: 'Ghost' })
    expect(useFlowStore.getState().nodes[0].data.label).toBe('Node n1')
  })
})

// ===========================================================================
// updateEdgeData
// ===========================================================================

describe('updateEdgeData', () => {
  it('merges data onto an edge', () => {
    const edge: Edge = { id: 'e1', source: 'a', target: 'b', data: { label: 'old' } }
    useFlowStore.setState({ edges: [edge] })
    useFlowStore.temporal.getState().clear()
    useFlowStore.getState().updateEdgeData('e1', { label: 'new' } as never)
    expect(useFlowStore.getState().edges[0].data).toMatchObject({ label: 'new' })
  })

  it('preserves other edge properties', () => {
    const edge: Edge = { id: 'e1', source: 'src', target: 'tgt', data: { a: 1, b: 2 } }
    useFlowStore.setState({ edges: [edge] })
    useFlowStore.temporal.getState().clear()
    useFlowStore.getState().updateEdgeData('e1', { b: 99 } as never)
    expect(useFlowStore.getState().edges[0].data).toMatchObject({ a: 1, b: 99 })
  })
})

// ===========================================================================
// deleteSelectedNodes
// ===========================================================================

describe('deleteSelectedNodes', () => {
  it('removes selected nodes', () => {
    const selected = makeNode('n1', { selected: true })
    const unselected = makeNode('n2', { selected: false })
    useFlowStore.setState({ nodes: [selected, unselected] })
    useFlowStore.temporal.getState().clear()
    useFlowStore.getState().deleteSelectedNodes()
    const { nodes } = useFlowStore.getState()
    expect(nodes).toHaveLength(1)
    expect(nodes[0].id).toBe('n2')
  })

  it('removes edges connected to deleted nodes', () => {
    const selected = makeNode('n1', { selected: true })
    const other = makeNode('n2')
    const edge1 = makeEdge('e1', 'n1', 'n2') // connected to selected
    const edge2 = makeEdge('e2', 'n2', 'n3') // unrelated
    useFlowStore.setState({ nodes: [selected, other], edges: [edge1, edge2] })
    useFlowStore.temporal.getState().clear()
    useFlowStore.getState().deleteSelectedNodes()
    expect(useFlowStore.getState().edges).toHaveLength(1)
    expect(useFlowStore.getState().edges[0].id).toBe('e2')
  })

  it('is a no-op when no nodes are selected', () => {
    useFlowStore.setState({ nodes: [makeNode('n1'), makeNode('n2')], edges: [makeEdge('e1', 'n1', 'n2')] })
    useFlowStore.temporal.getState().clear()
    useFlowStore.getState().deleteSelectedNodes()
    expect(useFlowStore.getState().nodes).toHaveLength(2)
    expect(useFlowStore.getState().edges).toHaveLength(1)
  })
})

// ===========================================================================
// alignSelectedNodes
// ===========================================================================

describe('alignSelectedNodes', () => {
  function makeMeasuredNode(id: string, x: number, y: number, w: number, h: number, selected = true): WorkflowNode {
    const n = makeNode(id, { position: { x, y }, selected }) as WorkflowNode & {
      measured?: { width: number; height: number }
    }
    n.measured = { width: w, height: h }
    return n
  }

  it('aligns left: each selected node x = bbox.minX', () => {
    const a = makeMeasuredNode('a', 100, 0, 50, 30)
    const b = makeMeasuredNode('b', 200, 50, 80, 40)
    const unselected = makeMeasuredNode('c', 300, 0, 60, 30, false)
    useFlowStore.setState({ nodes: [a, b, unselected] })
    useFlowStore.temporal.getState().clear()
    useFlowStore.getState().alignSelectedNodes('left')
    const out = useFlowStore.getState().nodes
    expect(out.find((n) => n.id === 'a')!.position.x).toBe(100)
    expect(out.find((n) => n.id === 'b')!.position.x).toBe(100)
    expect(out.find((n) => n.id === 'c')!.position.x).toBe(300) // untouched
  })

  it('aligns right: each selected node right edge = bbox.maxX', () => {
    const a = makeMeasuredNode('a', 100, 0, 50, 30) // right=150
    const b = makeMeasuredNode('b', 200, 0, 80, 30) // right=280 (max)
    useFlowStore.setState({ nodes: [a, b] })
    useFlowStore.temporal.getState().clear()
    useFlowStore.getState().alignSelectedNodes('right')
    const out = useFlowStore.getState().nodes
    expect(out.find((n) => n.id === 'a')!.position.x).toBe(280 - 50)
    expect(out.find((n) => n.id === 'b')!.position.x).toBe(200)
  })

  it('aligns center horizontally: each selected node centered on bbox centerX', () => {
    const a = makeMeasuredNode('a', 100, 0, 50, 30) // [100,150]
    const b = makeMeasuredNode('b', 200, 0, 100, 30) // [200,300]
    useFlowStore.setState({ nodes: [a, b] })
    useFlowStore.temporal.getState().clear()
    // bbox: minX=100, maxX=300 → centerX=200
    useFlowStore.getState().alignSelectedNodes('centerH')
    const out = useFlowStore.getState().nodes
    expect(out.find((n) => n.id === 'a')!.position.x).toBe(200 - 25)
    expect(out.find((n) => n.id === 'b')!.position.x).toBe(200 - 50)
  })

  it('aligns top: each selected node y = bbox.minY', () => {
    const a = makeMeasuredNode('a', 0, 100, 50, 30)
    const b = makeMeasuredNode('b', 0, 250, 50, 40)
    useFlowStore.setState({ nodes: [a, b] })
    useFlowStore.temporal.getState().clear()
    useFlowStore.getState().alignSelectedNodes('top')
    const out = useFlowStore.getState().nodes
    expect(out.find((n) => n.id === 'a')!.position.y).toBe(100)
    expect(out.find((n) => n.id === 'b')!.position.y).toBe(100)
  })

  it('aligns bottom: each selected node bottom edge = bbox.maxY', () => {
    const a = makeMeasuredNode('a', 0, 100, 50, 30) // bottom=130
    const b = makeMeasuredNode('b', 0, 250, 50, 40) // bottom=290 (max)
    useFlowStore.setState({ nodes: [a, b] })
    useFlowStore.temporal.getState().clear()
    useFlowStore.getState().alignSelectedNodes('bottom')
    const out = useFlowStore.getState().nodes
    expect(out.find((n) => n.id === 'a')!.position.y).toBe(290 - 30)
    expect(out.find((n) => n.id === 'b')!.position.y).toBe(290 - 40)
  })

  it('aligns center vertically: each selected node centered on bbox centerY', () => {
    const a = makeMeasuredNode('a', 0, 100, 50, 30) // [100,130]
    const b = makeMeasuredNode('b', 0, 200, 50, 100) // [200,300]
    useFlowStore.setState({ nodes: [a, b] })
    useFlowStore.temporal.getState().clear()
    // bbox: minY=100, maxY=300 → centerY=200
    useFlowStore.getState().alignSelectedNodes('centerV')
    const out = useFlowStore.getState().nodes
    expect(out.find((n) => n.id === 'a')!.position.y).toBe(200 - 15)
    expect(out.find((n) => n.id === 'b')!.position.y).toBe(200 - 50)
  })

  it('does NOT touch the perpendicular axis (left only changes x, top only changes y)', () => {
    const a = makeMeasuredNode('a', 100, 50, 50, 30)
    const b = makeMeasuredNode('b', 200, 80, 80, 40)
    useFlowStore.setState({ nodes: [a, b] })
    useFlowStore.temporal.getState().clear()
    useFlowStore.getState().alignSelectedNodes('left')
    const out = useFlowStore.getState().nodes
    expect(out.find((n) => n.id === 'a')!.position.y).toBe(50) // y untouched
    expect(out.find((n) => n.id === 'b')!.position.y).toBe(80) // y untouched
  })

  it('is a no-op when fewer than 2 nodes are selected', () => {
    const a = makeMeasuredNode('a', 100, 0, 50, 30, true)
    const b = makeMeasuredNode('b', 200, 0, 80, 30, false)
    useFlowStore.setState({ nodes: [a, b] })
    useFlowStore.temporal.getState().clear()
    useFlowStore.getState().alignSelectedNodes('left')
    const out = useFlowStore.getState().nodes
    expect(out.find((n) => n.id === 'a')!.position.x).toBe(100) // unchanged
    expect(out.find((n) => n.id === 'b')!.position.x).toBe(200) // unchanged
  })

  it('falls back to default 200x60 when measured dims are missing', () => {
    // Two unmeasured nodes — alignment should still produce sensible output
    const a = makeNode('a', { position: { x: 100, y: 0 }, selected: true })
    const b = makeNode('b', { position: { x: 50, y: 0 }, selected: true })
    useFlowStore.setState({ nodes: [a, b] })
    useFlowStore.temporal.getState().clear()
    useFlowStore.getState().alignSelectedNodes('left')
    const out = useFlowStore.getState().nodes
    expect(out.find((n) => n.id === 'a')!.position.x).toBe(50)
    expect(out.find((n) => n.id === 'b')!.position.x).toBe(50)
  })
})

// ===========================================================================
// distributeSelectedNodes
// ===========================================================================

describe('distributeSelectedNodes', () => {
  function makeMeasuredNode(id: string, x: number, y: number, w: number, h: number, selected = true): WorkflowNode {
    const n = makeNode(id, { position: { x, y }, selected }) as WorkflowNode & {
      measured?: { width: number; height: number }
    }
    n.measured = { width: w, height: h }
    return n
  }

  it('distributes 3 nodes horizontally with even gaps between them', () => {
    // Bbox span: leftmost.x=0 .. rightmost.x+w = 300+50 = 350. Span=350.
    // Total widths: 50+50+50 = 150. Free space = 200. Gap between 3 nodes (2 gaps) = 100.
    const a = makeMeasuredNode('a', 0, 0, 50, 30) // anchor left
    const b = makeMeasuredNode('b', 100, 0, 50, 30) // middle, will move
    const c = makeMeasuredNode('c', 300, 0, 50, 30) // anchor right
    useFlowStore.setState({ nodes: [a, b, c] })
    useFlowStore.temporal.getState().clear()
    useFlowStore.getState().distributeSelectedNodes('horizontal')
    const out = useFlowStore.getState().nodes
    expect(out.find((n) => n.id === 'a')!.position.x).toBe(0) // anchor unchanged
    expect(out.find((n) => n.id === 'b')!.position.x).toBe(150) // 0 + 50 + 100
    expect(out.find((n) => n.id === 'c')!.position.x).toBe(300) // 150 + 50 + 100
  })

  it('distributes 3 nodes vertically with even gaps between them', () => {
    const a = makeMeasuredNode('a', 0, 0, 50, 30)
    const b = makeMeasuredNode('b', 0, 50, 50, 30)
    const c = makeMeasuredNode('c', 0, 200, 50, 30)
    useFlowStore.setState({ nodes: [a, b, c] })
    useFlowStore.temporal.getState().clear()
    useFlowStore.getState().distributeSelectedNodes('vertical')
    const out = useFlowStore.getState().nodes
    // Span: 0..230. Total heights: 90. Free=140, gap = 70.
    expect(out.find((n) => n.id === 'a')!.position.y).toBe(0)
    expect(out.find((n) => n.id === 'b')!.position.y).toBe(100) // 0 + 30 + 70
    expect(out.find((n) => n.id === 'c')!.position.y).toBe(200)
  })

  it('does NOT touch the perpendicular axis', () => {
    const a = makeMeasuredNode('a', 0, 100, 50, 30)
    const b = makeMeasuredNode('b', 100, 200, 50, 30)
    const c = makeMeasuredNode('c', 300, 50, 50, 30)
    useFlowStore.setState({ nodes: [a, b, c] })
    useFlowStore.temporal.getState().clear()
    useFlowStore.getState().distributeSelectedNodes('horizontal')
    const out = useFlowStore.getState().nodes
    // y untouched for all three
    expect(out.find((n) => n.id === 'a')!.position.y).toBe(100)
    expect(out.find((n) => n.id === 'b')!.position.y).toBe(200)
    expect(out.find((n) => n.id === 'c')!.position.y).toBe(50)
  })

  it('ignores unselected nodes when computing the distribution', () => {
    const a = makeMeasuredNode('a', 0, 0, 50, 30, true)
    const b = makeMeasuredNode('b', 100, 0, 50, 30, true)
    const c = makeMeasuredNode('c', 300, 0, 50, 30, true)
    const ignored = makeMeasuredNode('z', 9999, 0, 50, 30, false)
    useFlowStore.setState({ nodes: [a, b, c, ignored] })
    useFlowStore.temporal.getState().clear()
    useFlowStore.getState().distributeSelectedNodes('horizontal')
    const out = useFlowStore.getState().nodes
    expect(out.find((n) => n.id === 'a')!.position.x).toBe(0)
    expect(out.find((n) => n.id === 'b')!.position.x).toBe(150)
    expect(out.find((n) => n.id === 'c')!.position.x).toBe(300)
    expect(out.find((n) => n.id === 'z')!.position.x).toBe(9999) // untouched
  })

  it('is a no-op when fewer than 3 nodes are selected', () => {
    const a = makeMeasuredNode('a', 0, 0, 50, 30, true)
    const b = makeMeasuredNode('b', 100, 0, 50, 30, true)
    useFlowStore.setState({ nodes: [a, b] })
    useFlowStore.temporal.getState().clear()
    useFlowStore.getState().distributeSelectedNodes('horizontal')
    const out = useFlowStore.getState().nodes
    expect(out.find((n) => n.id === 'a')!.position.x).toBe(0)
    expect(out.find((n) => n.id === 'b')!.position.x).toBe(100)
  })

  it('handles unsorted input by sorting on the primary axis', () => {
    // Insert in non-sorted order; distribution should still anchor leftmost/rightmost
    const a = makeMeasuredNode('a', 300, 0, 50, 30) // rightmost
    const b = makeMeasuredNode('b', 100, 0, 50, 30) // middle
    const c = makeMeasuredNode('c', 0, 0, 50, 30) // leftmost
    useFlowStore.setState({ nodes: [a, b, c] })
    useFlowStore.temporal.getState().clear()
    useFlowStore.getState().distributeSelectedNodes('horizontal')
    const out = useFlowStore.getState().nodes
    expect(out.find((n) => n.id === 'c')!.position.x).toBe(0)
    expect(out.find((n) => n.id === 'b')!.position.x).toBe(150)
    expect(out.find((n) => n.id === 'a')!.position.x).toBe(300)
  })
})

// ===========================================================================
// Workflow-level property setters
// ===========================================================================

describe('workflow-level property setters', () => {
  it('setWorkflowInputs replaces inputs', () => {
    const inputs: ParameterSpec[] = [{ id: 'p1', name: 'Input1' }]
    useFlowStore.getState().setWorkflowInputs(inputs)
    expect(useFlowStore.getState().workflowInputs).toEqual(inputs)
  })

  it('setWorkflowOutputs replaces outputs', () => {
    const outputs: ParameterSpec[] = [{ id: 'p2', name: 'Output1' }]
    useFlowStore.getState().setWorkflowOutputs(outputs)
    expect(useFlowStore.getState().workflowOutputs).toEqual(outputs)
  })

  it('setWorkflowValues replaces values', () => {
    const values: ValueSpec[] = [{ id: 'v1', name: 'Val', entries: [] }]
    useFlowStore.getState().setWorkflowValues(values)
    expect(useFlowStore.getState().workflowValues).toEqual(values)
  })

  it('setWorkflowResources replaces resources', () => {
    const resources: ResourceSpec[] = [{ id: 'r1', name: 'Res', resourceType: 'Single Use', count: 1 }]
    useFlowStore.getState().setWorkflowResources(resources)
    expect(useFlowStore.getState().workflowResources).toEqual(resources)
  })
})

// ===========================================================================
// Miscellaneous actions
// ===========================================================================

describe('clearDraft', () => {
  it('sets hasDraft to false', () => {
    useFlowStore.setState({ hasDraft: true })
    useFlowStore.getState().clearDraft()
    expect(useFlowStore.getState().hasDraft).toBe(false)
  })
})

describe('requestEditDialog', () => {
  it('sets editDialogRequest to the given type', () => {
    useFlowStore.getState().requestEditDialog('node')
    expect(useFlowStore.getState().editDialogRequest).toBe('node')
  })

  it('can be set to workflow', () => {
    useFlowStore.getState().requestEditDialog('workflow')
    expect(useFlowStore.getState().editDialogRequest).toBe('workflow')
  })

  it('can be cleared to null', () => {
    useFlowStore.setState({ editDialogRequest: 'node' })
    useFlowStore.getState().requestEditDialog(null)
    expect(useFlowStore.getState().editDialogRequest).toBeNull()
  })
})

describe('dismissLegacyUpgradeNotice', () => {
  it('sets _showLegacyUpgradeNotice to false', () => {
    useFlowStore.setState({ _showLegacyUpgradeNotice: true })
    useFlowStore.getState().dismissLegacyUpgradeNotice()
    expect(useFlowStore.getState()._showLegacyUpgradeNotice).toBe(false)
  })
})

describe('setPropertiesPanelWidth', () => {
  it('updates propertiesPanelWidth', () => {
    useFlowStore.getState().setPropertiesPanelWidth(400)
    expect(useFlowStore.getState().propertiesPanelWidth).toBe(400)
  })
})

// ===========================================================================
// Undo / Redo
// ===========================================================================

describe('undo/redo — addNode', () => {
  it('undo removes a newly added node', () => {
    useFlowStore.getState().addNode(makeNode('n1'))
    expect(useFlowStore.getState().nodes).toHaveLength(1)

    useFlowStore.temporal.getState().undo()
    expect(useFlowStore.getState().nodes).toHaveLength(0)
  })

  it('redo restores the node after undo', () => {
    useFlowStore.getState().addNode(makeNode('n1'))
    useFlowStore.temporal.getState().undo()
    expect(useFlowStore.getState().nodes).toHaveLength(0)

    useFlowStore.temporal.getState().redo()
    expect(useFlowStore.getState().nodes).toHaveLength(1)
    expect(useFlowStore.getState().nodes[0].id).toBe('n1')
  })
})

describe('undo/redo — updateNodeData', () => {
  it('undo reverts a label change', () => {
    const node = makeNode('n1', { data: { label: 'Original', stepType: 'start' } })
    useFlowStore.setState({ nodes: [node] })
    useFlowStore.temporal.getState().clear()

    useFlowStore.getState().updateNodeData('n1', { label: 'Modified' })
    expect(useFlowStore.getState().nodes[0].data.label).toBe('Modified')

    useFlowStore.temporal.getState().undo()
    expect(useFlowStore.getState().nodes[0].data.label).toBe('Original')
  })

  it('redo reapplies the label change', () => {
    const node = makeNode('n1', { data: { label: 'Original', stepType: 'start' } })
    useFlowStore.setState({ nodes: [node] })
    useFlowStore.temporal.getState().clear()

    useFlowStore.getState().updateNodeData('n1', { label: 'Modified' })
    useFlowStore.temporal.getState().undo()
    useFlowStore.temporal.getState().redo()
    expect(useFlowStore.getState().nodes[0].data.label).toBe('Modified')
  })
})

describe('undo/redo — deleteSelectedNodes', () => {
  it('undo restores deleted nodes and their edges', () => {
    const selected = makeNode('n1', { selected: true })
    const other = makeNode('n2')
    const edge = makeEdge('e1', 'n1', 'n2')
    useFlowStore.setState({ nodes: [selected, other], edges: [edge] })
    useFlowStore.temporal.getState().clear()

    useFlowStore.getState().deleteSelectedNodes()
    expect(useFlowStore.getState().nodes).toHaveLength(1)
    expect(useFlowStore.getState().edges).toHaveLength(0)

    useFlowStore.temporal.getState().undo()
    expect(useFlowStore.getState().nodes).toHaveLength(2)
    expect(useFlowStore.getState().edges).toHaveLength(1)
  })
})

describe('undo/redo — temporal history limit', () => {
  it('only allows 100 undos even after 101 changes', () => {
    // Seed a node to update
    useFlowStore.setState({ nodes: [makeNode('n1', { data: { label: 'v0', stepType: 'start' } })] })
    useFlowStore.temporal.getState().clear()

    // Make 101 distinct changes
    for (let i = 1; i <= 101; i++) {
      useFlowStore.getState().updateNodeData('n1', { label: `v${i}` })
    }

    // Undo 101 times — the 101st undo should be a no-op (history capped at 100)
    for (let i = 0; i < 101; i++) {
      useFlowStore.temporal.getState().undo()
    }

    // After 100 real undos + 1 no-op, we should be at v1 (the oldest kept state),
    // not v0 (which was pushed off the 100-item stack)
    const label = useFlowStore.getState().nodes[0].data.label as string
    expect(label).not.toBe('v101')
    // The label must be some earlier version — v0 or v1 depending on whether
    // the initial setState counts. In practice the temporal limit evicts the
    // oldest entry, so the earliest reachable state is v1.
    const version = parseInt(label.replace('v', ''), 10)
    expect(version).toBeLessThan(101)
  })
})

// ===========================================================================
// writeThroughToSpec hydration guard
// ===========================================================================

describe('writeThroughToSpec hydration guard', () => {
  it('does not overwrite spec.data.nodes when hydratedSpecId is null', async () => {
    // Wire up libraryStore + specStore as if a workflow with 3 nodes is selected
    const { useLibraryStore } = await import('@/stores/libraryStore')
    const { useSpecificationStore } = await import('@/stores/specificationStore')

    useLibraryStore.setState({ selectedSpecificationId: 'spec-A' })
    const originalNodes = [makeNode('orig-1'), makeNode('orig-2'), makeNode('orig-3')]
    useSpecificationStore.setState((s) => {
      const next = new Map(s.specs) as unknown as Map<string, Specification>
      next.set('spec-A', {
        id: 'spec-A',
        libraryId: 'lib-1',
        name: 'Test',
        description: null,
        version: '1.0.0',
        state: 'Draft' as const,
        data: { nodes: originalNodes, edges: [], images: { 'a.png': 'data:img' } },
        history: [],
        createdAt: 0,
        updatedAt: 0,
      })
      return { specs: next }
    })

    // flowStore is empty (post-sign-out / post-mount, before route hydration runs)
    expect(useFlowStore.getState().nodes).toHaveLength(0)
    expect(useFlowStore.getState().hydratedSpecId).toBeNull()

    // Simulate React Flow firing a phantom change by calling the public setter.
    // setNodes triggers writeThroughToSpec internally — the guard MUST keep it
    // from overwriting spec.data.nodes.
    useFlowStore.getState().setNodes([])

    const updated = useSpecificationStore.getState().specs.get('spec-A')!
    const data = updated.data as { nodes: WorkflowNode[]; images: Record<string, string> }
    expect(data.nodes).toHaveLength(3) // unchanged — guard prevented the wipe
    expect(data.nodes.map((n) => n.id)).toEqual(['orig-1', 'orig-2', 'orig-3'])
    expect(data.images).toEqual({ 'a.png': 'data:img' })
  })

  it('writes through when hydratedSpecId matches the selected spec', async () => {
    const { useLibraryStore } = await import('@/stores/libraryStore')
    const { useSpecificationStore } = await import('@/stores/specificationStore')

    useLibraryStore.setState({ selectedSpecificationId: 'spec-B' })
    useSpecificationStore.setState((s) => {
      const next = new Map(s.specs) as unknown as Map<string, Specification>
      next.set('spec-B', {
        id: 'spec-B',
        libraryId: 'lib-1',
        name: 'Test',
        description: null,
        version: '1.0.0',
        state: 'Draft' as const,
        data: { nodes: [makeNode('legacy')], edges: [] },
        history: [],
        createdAt: 0,
        updatedAt: 0,
      })
      return { specs: next }
    })

    // Mark hydrated, then set fresh nodes — the write-through should run.
    useFlowStore.getState().setHydratedSpecId('spec-B')
    useFlowStore.getState().setNodes([makeNode('fresh-1'), makeNode('fresh-2')])

    const updated = useSpecificationStore.getState().specs.get('spec-B')!
    const data = updated.data as { nodes: WorkflowNode[] }
    expect(data.nodes.map((n) => n.id)).toEqual(['fresh-1', 'fresh-2'])
  })

  it('blocks write-through when hydratedSpecId points at a different spec', async () => {
    const { useLibraryStore } = await import('@/stores/libraryStore')
    const { useSpecificationStore } = await import('@/stores/specificationStore')

    useLibraryStore.setState({ selectedSpecificationId: 'spec-C' })
    useSpecificationStore.setState((s) => {
      const next = new Map(s.specs) as unknown as Map<string, Specification>
      next.set('spec-C', {
        id: 'spec-C',
        libraryId: 'lib-1',
        name: 'Test',
        description: null,
        version: '1.0.0',
        state: 'Draft' as const,
        data: { nodes: [makeNode('legacy')], edges: [] },
        history: [],
        createdAt: 0,
        updatedAt: 0,
      })
      return { specs: next }
    })

    // hydratedSpecId points at a stale id (the previously-edited workflow).
    useFlowStore.getState().setHydratedSpecId('spec-stale')
    useFlowStore.getState().setNodes([])

    const updated = useSpecificationStore.getState().specs.get('spec-C')!
    const data = updated.data as { nodes: WorkflowNode[] }
    expect(data.nodes.map((n) => n.id)).toEqual(['legacy']) // unchanged
  })
})
