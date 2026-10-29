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

import { memo, useState, useCallback, useRef, type CSSProperties } from 'react'
import { EdgeLabelRenderer, Position, type EdgeProps, type Edge } from '@xyflow/react'
import { useFlowStore } from '@/stores/flowStore'
import type { ConditionalEdgeData, EdgeWaypoint } from '@/types/edges'
import type { StepNodeData } from '@/types/nodes'
import { describeSelect1Option } from '@/lib/select1-condition'
import { SELECTION_COLOR } from '@/components/nodes/renderers/shared/colors'

type ConditionalEdgeType = Edge<ConditionalEdgeData, 'conditional'>

interface Point {
  x: number
  y: number
}

interface Segment {
  start: Point
  end: Point
  isHorizontal: boolean
  midpoint: Point
  index: number
}

/**
 * Calculate orthogonal path points based on source/target positions and waypoints.
 * Creates a 4-point path for forward flow, or a 6-point bypass path for backward
 * connections (loops). Backward paths route around both nodes with a 2-grid-mark
 * turnaround so the line never crosses either the source or target node.
 */
function calculatePathPoints(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  sourcePosition: Position,
  _targetPosition: Position,
  waypoints: EdgeWaypoint[] = [],
): Point[] {
  const points: Point[] = []
  const offset = 5 // Base offset from node
  const TURN = 20 // 2 grid marks — turnaround distance before routing around
  const NODE_CLEARANCE_V = 30 // Vertical clearance to route around nodes
  const NODE_CLEARANCE_H = 50 // Horizontal clearance to route around nodes

  // Start point
  points.push({ x: sourceX, y: sourceY })

  // Determine flow direction based on source/target positions
  const isVerticalFlow = sourcePosition === Position.Bottom || sourcePosition === Position.Top

  // Get waypoint offsets (default to 0)
  const wpX = waypoints[0]?.x || 0
  const wpY = waypoints[0]?.y || 0

  if (isVerticalFlow) {
    // Vertical flow (TB) — source at Bottom, target at Top
    const isBackward = targetY < sourceY

    if (isBackward) {
      // Backward loop — go down first, route to the right of both nodes, come back up
      const routeX = Math.max(sourceX, targetX) + NODE_CLEARANCE_H + wpX
      points.push({ x: sourceX, y: sourceY + TURN }) // Down 2 grid marks
      points.push({ x: routeX, y: sourceY + TURN }) // Right to bypass lane
      points.push({ x: routeX, y: targetY - TURN }) // Up past target
      points.push({ x: targetX, y: targetY - TURN }) // Left to above target
    } else {
      // Forward flow — existing orthogonal routing
      const verticalDistance = Math.abs(targetY - sourceY)
      const horizontalDistance = Math.abs(targetX - sourceX)

      if (verticalDistance > 5 && horizontalDistance > 5) {
        const midY = (sourceY + targetY) / 2 + wpY
        points.push({ x: sourceX, y: midY })
        points.push({ x: targetX, y: midY })
      } else {
        const nearY = sourceY + offset
        points.push({ x: sourceX, y: nearY })
        points.push({ x: targetX, y: nearY })
      }
    }
  } else {
    // Horizontal flow (LR) — source at Right, target at Left
    const isBackward = targetX < sourceX

    if (isBackward) {
      // Backward loop — go right first, route below both nodes, come back left
      const routeY = Math.max(sourceY, targetY) + NODE_CLEARANCE_V + wpY
      points.push({ x: sourceX + TURN, y: sourceY }) // Right 2 grid marks
      points.push({ x: sourceX + TURN, y: routeY }) // Down to bypass lane
      points.push({ x: targetX - TURN, y: routeY }) // Left past target
      points.push({ x: targetX - TURN, y: targetY }) // Up to target level
    } else {
      // Forward flow — existing orthogonal routing
      const horizontalDistance = Math.abs(targetX - sourceX)
      const verticalDistance = Math.abs(targetY - sourceY)

      if (horizontalDistance > 5 && verticalDistance > 5) {
        const midX = (sourceX + targetX) / 2 + wpX
        points.push({ x: midX, y: sourceY })
        points.push({ x: midX, y: targetY })
      } else {
        const nearX = sourceX + offset
        points.push({ x: nearX, y: sourceY })
        points.push({ x: nearX, y: targetY })
      }
    }
  }

  // End point
  points.push({ x: targetX, y: targetY })

  return points
}

/**
 * Generate SVG path string from points
 */
function generatePathString(points: Point[]): string {
  if (points.length < 2) return ''

  let path = `M ${points[0].x} ${points[0].y}`
  for (let i = 1; i < points.length; i++) {
    path += ` L ${points[i].x} ${points[i].y}`
  }
  return path
}

/**
 * Extract segments from path points for handle rendering
 */
function extractSegments(points: Point[]): Segment[] {
  const segments: Segment[] = []

  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i]
    const end = points[i + 1]
    const isHorizontal = Math.abs(start.y - end.y) < 1

    segments.push({
      start,
      end,
      isHorizontal,
      midpoint: {
        x: (start.x + end.x) / 2,
        y: (start.y + end.y) / 2,
      },
      index: i,
    })
  }

  return segments
}

/**
 * Draggable handle component for edge segments
 */
function DragHandle({
  segment,
  onDrag,
  selected,
}: {
  segment: Segment
  onDrag: (deltaX: number, deltaY: number, segmentIndex: number) => void
  selected: boolean
}) {
  const [isDragging, setIsDragging] = useState(false)
  const startPos = useRef({ x: 0, y: 0 })

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      setIsDragging(true)
      startPos.current = { x: e.clientX, y: e.clientY }

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - startPos.current.x
        const deltaY = moveEvent.clientY - startPos.current.y

        // For horizontal segments, only allow vertical movement
        // For vertical segments, only allow horizontal movement
        if (segment.isHorizontal) {
          onDrag(0, deltaY, segment.index)
        } else {
          onDrag(deltaX, 0, segment.index)
        }

        startPos.current = { x: moveEvent.clientX, y: moveEvent.clientY }
      }

      const handleMouseUp = () => {
        setIsDragging(false)
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [segment, onDrag],
  )

  // Don't show handles for very short segments
  const segmentLength = segment.isHorizontal
    ? Math.abs(segment.end.x - segment.start.x)
    : Math.abs(segment.end.y - segment.start.y)

  if (segmentLength < 20) return null

  return (
    <div
      style={{
        position: 'absolute',
        left: segment.midpoint.x,
        top: segment.midpoint.y,
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'all',
        zIndex: 1001,
      }}
      className="nodrag nopan"
    >
      <div
        onMouseDown={handleMouseDown}
        className={`
          w-3 h-3 rounded-full border-2 transition-all
          ${
            isDragging
              ? 'bg-blue-500 border-blue-600 scale-125'
              : selected
                ? 'bg-blue-400 border-blue-500 hover:bg-blue-500'
                : 'bg-slate-300 border-slate-400 hover:bg-slate-400'
          }
          ${segment.isHorizontal ? 'cursor-ns-resize' : 'cursor-ew-resize'}
        `}
        title={segment.isHorizontal ? 'Drag to move segment vertically' : 'Drag to move segment horizontally'}
      />
    </div>
  )
}

/**
 * Invisible hover zone on the edge that shows a tooltip with the connection expression.
 * Labels are hidden by default to prevent overlap on closely-spaced Select1 connections.
 */
function SelectEdgeTooltip({ labelX, labelY, label }: { labelX: number; labelY: number; label: string }) {
  const [hovered, setHovered] = useState(false)

  const containerStyle: CSSProperties = {
    position: 'absolute',
    transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
    pointerEvents: 'all',
    zIndex: 1000,
  }

  return (
    <div
      style={containerStyle}
      className="nodrag nopan"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Invisible hit area */}
      <div className="w-4 h-4 rounded-full" />
      {/* Tooltip shown on hover */}
      {hovered && (
        <div
          className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1 px-2 py-1 text-[10px] text-white whitespace-nowrap bg-slate-800 rounded shadow-lg"
          style={{ zIndex: 1001 }}
        >
          {label}
          <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-slate-800" />
        </div>
      )}
    </div>
  )
}

function ConditionalEdgeComponent({
  id,
  source,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  sourceHandleId,
  data,
  markerEnd,
  style,
  selected,
}: EdgeProps<ConditionalEdgeType>) {
  const updateEdgeData = useFlowStore((state) => state.updateEdgeData)
  const nodes = useFlowStore((state) => state.nodes)

  // Subscribe directly to this edge's data from the store for reliable updates
  const edges = useFlowStore((state) => state.edges)
  const storeEdge = edges.find((e) => e.id === id)
  const storeWaypoints = (storeEdge?.data as ConditionalEdgeData | undefined)?.waypoints

  // Get waypoints from store (most up-to-date) or fall back to props
  const waypoints = storeWaypoints || data?.waypoints || []

  // Calculate path points with waypoints
  const pathPoints = calculatePathPoints(sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, waypoints)

  // Generate path string
  const edgePath = generatePathString(pathPoints)

  // Extract segments for handle rendering
  const segments = extractSegments(pathPoints)

  // Calculate label position (middle of the path)
  const labelX = (sourceX + targetX) / 2
  const labelY = (sourceY + targetY) / 2 + (waypoints[0]?.y || 0)

  // Check if source node is a SELECT node and derive label from its options
  const sourceNode = nodes.find((n) => n.id === source)
  const isFromSelect = sourceNode?.type === 'select1'

  const selectLabel =
    isFromSelect && sourceNode ? describeSelect1Option(sourceNode.data as StepNodeData, sourceHandleId).text : ''

  const handleSegmentDrag = useCallback(
    (deltaX: number, deltaY: number, segmentIndex: number) => {
      // Get current waypoints directly from store for most accurate state
      const currentEdges = useFlowStore.getState().edges
      const currentEdge = currentEdges.find((e) => e.id === id)
      const currentWaypoints = (currentEdge?.data as ConditionalEdgeData | undefined)?.waypoints || [{ x: 0, y: 0 }]

      // Calculate new waypoint values
      let newX = currentWaypoints[0]?.x || 0
      let newY = currentWaypoints[0]?.y || 0

      // Determine flow direction and backward state
      const isVerticalFlow = sourcePosition === Position.Bottom || sourcePosition === Position.Top
      const isBackward = isVerticalFlow ? targetY < sourceY : targetX < sourceX

      if (isBackward) {
        // Backward paths: segment 2 is the long bypass segment
        if (isVerticalFlow) {
          // Vertical backward: bypass runs vertically on the right — drag horizontally
          if (segmentIndex === 2) {
            newX += deltaX
          }
        } else {
          // Horizontal backward: bypass runs horizontally below — drag vertically
          if (segmentIndex === 2) {
            newY += deltaY
          }
        }
      } else {
        // Forward paths: segment 1 is the middle crossover segment
        if (isVerticalFlow) {
          if (segmentIndex === 1) {
            newY += deltaY
          }
        } else {
          if (segmentIndex === 1) {
            newX += deltaX
          }
        }
      }

      // Snap to grid (5px)
      newX = Math.round(newX / 5) * 5
      newY = Math.round(newY / 5) * 5

      const newWaypoints: EdgeWaypoint[] = [{ x: newX, y: newY }]

      updateEdgeData(id, { waypoints: newWaypoints })
    },
    [id, updateEdgeData, sourcePosition, sourceX, sourceY, targetX, targetY],
  )

  const edgeStyle = {
    ...style,
    stroke: selected ? SELECTION_COLOR : style?.stroke,
    strokeWidth: selected ? 2 : style?.strokeWidth,
    fill: 'none',
  }

  const showLabel = isFromSelect && selectLabel

  return (
    <>
      {/* Main edge path */}
      <path id={id} d={edgePath} style={edgeStyle} markerEnd={markerEnd} className="react-flow__edge-path" />

      {/* Invisible wider path for easier selection */}
      <path d={edgePath} fill="none" strokeWidth={15} stroke="transparent" className="react-flow__edge-interaction" />

      {/* Drag handles for segments - only show when selected */}
      {selected && (
        <EdgeLabelRenderer>
          {segments.slice(1, -1).map((segment, idx) => (
            <DragHandle key={idx} segment={segment} onDrag={handleSegmentDrag} selected={selected} />
          ))}
        </EdgeLabelRenderer>
      )}

      {/* Hover tooltip for SELECT 1 edges (hidden by default to avoid label overlap) */}
      {showLabel && (
        <EdgeLabelRenderer>
          <SelectEdgeTooltip labelX={labelX} labelY={labelY} label={selectLabel} />
        </EdgeLabelRenderer>
      )}
    </>
  )
}

// Use memo with custom comparison to ensure re-renders on data changes
export const ConditionalEdge = memo(ConditionalEdgeComponent, (prevProps, nextProps) => {
  // Always re-render if basic props change
  if (
    prevProps.id !== nextProps.id ||
    prevProps.sourceX !== nextProps.sourceX ||
    prevProps.sourceY !== nextProps.sourceY ||
    prevProps.targetX !== nextProps.targetX ||
    prevProps.targetY !== nextProps.targetY ||
    prevProps.selected !== nextProps.selected ||
    prevProps.source !== nextProps.source ||
    prevProps.sourceHandleId !== nextProps.sourceHandleId
  ) {
    return false // Props changed, re-render
  }

  // Check if data changed (including waypoints)
  const prevData = prevProps.data
  const nextData = nextProps.data
  if (prevData?.condition !== nextData?.condition) {
    return false
  }

  // Check waypoints
  const prevWp = prevData?.waypoints
  const nextWp = nextData?.waypoints
  if (prevWp?.length !== nextWp?.length) {
    return false
  }
  if (prevWp && nextWp) {
    for (let i = 0; i < prevWp.length; i++) {
      if (prevWp[i]?.x !== nextWp[i]?.x || prevWp[i]?.y !== nextWp[i]?.y) {
        return false
      }
    }
  }

  return true // Props are equal, skip re-render
})
ConditionalEdge.displayName = 'ConditionalEdge'
