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

import { memo, useEffect } from 'react'
import { Handle, Position, useConnection, useUpdateNodeInternals, type NodeProps, type Node } from '@xyflow/react'
import { cn } from '@mission/ui'
import type { StepNodeData } from '@/types/nodes'
import { useNotationConfig } from '../shared/useNotationConfig'
import { SELECTION_COLOR, PARALLEL_PURPLE, PARALLEL_FILL } from '../shared/colors'
import { useIsa88Resize } from '../shared/useIsa88Resize'

type ParallelNodeType = Node<StepNodeData, 'parallel'>

/**
 * Unified Parallel (simultaneous divergence) node for all 3 notations.
 * - Flowchart: 40x40 double diamond "PARALLEL", circular target at top, BAR source at bottom
 * - BPMN: 20x30 diamond with + marker, circular handles at left/right
 * - ISA88: 40x20 double horizontal lines "PARALLEL", circular handles at top/bottom
 */
const ParallelNode = memo(({ id, selected, data }: NodeProps<ParallelNodeType>) => {
  const connection = useConnection()
  const isConnecting = connection.inProgress
  const isValidTarget = isConnecting

  const config = useNotationConfig()
  const { notation } = config
  const isBpmn = notation === 'bpmn'
  const strokeColor = selected ? SELECTION_COLOR : PARALLEL_PURPLE
  const { width: isa88Width, xOffset, startResize } = useIsa88Resize(data)
  const sourceHandles = (data.isa88SourceHandles || []) as string[]
  const totalSourceHandles = sourceHandles.length + 1

  // Recalculate handle positions when dynamic handles change
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => {
    updateNodeInternals([id])
  }, [sourceHandles.length, id, updateNodeInternals])

  return (
    <div
      className="relative"
      style={notation === 'isa88' && xOffset ? { transform: `translateX(${xOffset}px)` } : undefined}
    >
      {/* Flowchart: 60x60 double diamond */}
      {notation === 'flowchart' && (
        <svg width="60" height="60" viewBox="0 0 60 60">
          {/* Outer diamond */}
          <polygon points="30,2 58,30 30,58 2,30" fill="none" stroke={strokeColor} strokeWidth={selected ? 2 : 1} />
          {/* Inner diamond */}
          <polygon
            points="30,8 52,30 30,52 8,30"
            fill={PARALLEL_FILL}
            stroke={strokeColor}
            strokeWidth={selected ? 1 : 0.5}
          />
          <text x="30" y="33" textAnchor="middle" fontSize="7" fontWeight="500" fill="#6b21a8">
            PARALLEL
          </text>
        </svg>
      )}

      {/* BPMN: 40x50 diamond with + marker */}
      {isBpmn && (
        <svg width="40" height="50" viewBox="0 0 40 50">
          <polygon
            points="20,1 39,25 20,49 1,25"
            fill={PARALLEL_FILL}
            stroke={strokeColor}
            strokeWidth={selected ? 2 : 1}
          />
          {/* + marker inside diamond */}
          <line x1="20" y1="15" x2="20" y2="35" stroke={PARALLEL_PURPLE} strokeWidth="2" />
          <line x1="10" y1="25" x2="30" y2="25" stroke={PARALLEL_PURPLE} strokeWidth="2" />
        </svg>
      )}

      {/* ISA88: resizable double horizontal bars */}
      {notation === 'isa88' && (
        <div style={{ width: isa88Width, height: 40 }} className="relative">
          {/* Left resize handle */}
          <div
            className="nodrag nopan"
            onMouseDown={(e) => startResize(e, 'left')}
            style={{
              position: 'absolute',
              left: -3,
              top: 17,
              width: 6,
              height: 6,
              background: PARALLEL_PURPLE,
              border: '1px solid #7e22ce',
              borderRadius: 1,
              cursor: 'ew-resize',
              zIndex: 10,
            }}
          />
          {/* Right resize handle */}
          <div
            className="nodrag nopan"
            onMouseDown={(e) => startResize(e, 'right')}
            style={{
              position: 'absolute',
              right: -3,
              top: 17,
              width: 6,
              height: 6,
              background: PARALLEL_PURPLE,
              border: '1px solid #7e22ce',
              borderRadius: 1,
              cursor: 'ew-resize',
              zIndex: 10,
            }}
          />
          <svg width={isa88Width} height="40" viewBox={`0 0 ${isa88Width} 40`}>
            {/* Target stem: center top to upper bar */}
            <line x1={isa88Width / 2} y1={0} x2={isa88Width / 2} y2={14} stroke={strokeColor} strokeWidth={1} />
            {/* Source stems: lower bar to bottom for each source handle */}
            {sourceHandles.map((handleId, i) => {
              const x = ((i + 1) / (totalSourceHandles + 1)) * isa88Width
              return <line key={`s-${handleId}`} x1={x} y1={22} x2={x} y2={40} stroke={strokeColor} strokeWidth={1} />
            })}
            {/* Default source stem (dashed) */}
            <line
              x1={(totalSourceHandles / (totalSourceHandles + 1)) * isa88Width}
              y1={22}
              x2={(totalSourceHandles / (totalSourceHandles + 1)) * isa88Width}
              y2={40}
              stroke={PARALLEL_PURPLE}
              strokeWidth={0.5}
              strokeDasharray="2,2"
            />
            {/* Double horizontal bars */}
            <line x1="6" y1="14" x2={isa88Width - 6} y2="14" stroke={strokeColor} strokeWidth={selected ? 1.5 : 1} />
            <line x1="6" y1="22" x2={isa88Width - 6} y2="22" stroke={strokeColor} strokeWidth={selected ? 1.5 : 1} />
            <text x={isa88Width / 2} y="36" textAnchor="middle" fontSize="8" fontWeight="500" fill="#6b21a8">
              PARALLEL
            </text>
          </svg>
        </div>
      )}

      {/* Flowchart: circular target at top, BAR source at bottom */}
      {notation === 'flowchart' && (
        <>
          <Handle
            type="target"
            position={Position.Top}
            className={cn(
              '!w-2 !h-2 !rounded-full !bg-purple-500 !border-2 !border-white transition-all',
              isValidTarget && '!ring-2 !ring-blue-500 !scale-125 !bg-blue-500',
            )}
          />
          <Handle
            type="source"
            position={Position.Bottom}
            className="!w-5 !h-2 !rounded-sm !bg-purple-500 !border !border-purple-700"
          />
        </>
      )}

      {/* BPMN: circular handles at left and right, centered on diamond */}
      {isBpmn && (
        <>
          <Handle
            type="target"
            position={Position.Left}
            style={{ top: 25 }}
            className={cn(
              '!w-2 !h-2 !rounded-full !bg-purple-500 !border-2 !border-white transition-all',
              isValidTarget && '!ring-2 !ring-blue-500 !scale-125 !bg-blue-500',
            )}
          />
          <Handle
            type="source"
            position={Position.Right}
            style={{ top: 25 }}
            className="!w-2 !h-2 !rounded-full !bg-purple-500 !border-2 !border-white"
          />
        </>
      )}

      {/* ISA88: single target at top, dynamic source handles at bottom */}
      {notation === 'isa88' && (
        <>
          <Handle
            type="target"
            position={Position.Top}
            style={{ left: '50%' }}
            className={cn(
              '!w-2 !h-2 !rounded-full !bg-purple-500 !border-2 !border-white transition-all',
              isValidTarget && '!ring-2 !ring-blue-500 !scale-125 !bg-blue-500',
            )}
          />
          {sourceHandles.map((handleId, i) => (
            <Handle
              key={handleId}
              type="source"
              position={Position.Bottom}
              id={handleId}
              style={{ left: `${((i + 1) / (totalSourceHandles + 1)) * 100}%` }}
              className="!w-2 !h-2 !rounded-full !bg-purple-500 !border-2 !border-white"
            />
          ))}
          {/* "New connection" default source handle */}
          <div
            className="absolute bottom-0 flex items-center justify-center"
            style={{
              left: `${(totalSourceHandles / (totalSourceHandles + 1)) * 100}%`,
              transform: 'translate(-50%, 50%)',
            }}
          >
            <Handle
              type="source"
              position={Position.Bottom}
              id="default"
              className="!relative !transform-none !left-auto !top-auto !w-2 !h-2 !rounded-full !bg-purple-400 !border !border-purple-600"
            />
            <span className="absolute text-[8px] font-bold text-purple-800 leading-none pointer-events-none">+</span>
          </div>
        </>
      )}
    </div>
  )
})

ParallelNode.displayName = 'ParallelNode'
export default ParallelNode
