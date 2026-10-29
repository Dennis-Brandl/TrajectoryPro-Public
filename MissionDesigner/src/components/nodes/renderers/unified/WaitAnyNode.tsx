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
import { SELECTION_COLOR, GATEWAY_AMBER, GATEWAY_FILL } from '../shared/colors'
import { useIsa88Resize } from '../shared/useIsa88Resize'

type WaitAnyNodeType = Node<StepNodeData, 'waitAny'>

/**
 * Unified Wait Any (selection convergence) node for all 3 notations.
 * - Flowchart: 40x40 diamond "WAIT ANY", bar target at top, circular source at bottom
 * - BPMN: 20x30 diamond with pentagon marker, circular handles at left/right
 * - ISA88: 40x20 single horizontal line "WAIT ANY", circular handles at top/bottom
 */
const WaitAnyNode = memo(({ id, selected, data }: NodeProps<WaitAnyNodeType>) => {
  const connection = useConnection()
  const isConnecting = connection.inProgress
  const isValidTarget = isConnecting

  const config = useNotationConfig()
  const { notation } = config
  const isBpmn = notation === 'bpmn'
  const { width: isa88Width, xOffset, startResize } = useIsa88Resize(data)
  const targetHandles = (data.isa88TargetHandles || []) as string[]
  const totalTargetHandles = targetHandles.length + 1

  const barStroke = selected ? SELECTION_COLOR : GATEWAY_AMBER

  // Recalculate handle positions when dynamic handles change
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => {
    updateNodeInternals([id])
  }, [targetHandles.length, id, updateNodeInternals])

  return (
    <div
      className="relative"
      style={notation === 'isa88' && xOffset ? { transform: `translateX(${xOffset}px)` } : undefined}
    >
      {/* Flowchart: 60x60 diamond */}
      {notation === 'flowchart' && (
        <svg width="60" height="60" viewBox="0 0 60 60">
          <polygon
            points="30,2 58,30 30,58 2,30"
            fill={GATEWAY_FILL}
            stroke={selected ? SELECTION_COLOR : GATEWAY_AMBER}
            strokeWidth={selected ? 2 : 1}
          />
          <text x="30" y="27" textAnchor="middle" fontSize="8" fontWeight="500" fill="#92400e">
            WAIT
          </text>
          <text x="30" y="38" textAnchor="middle" fontSize="8" fontWeight="500" fill="#92400e">
            ANY
          </text>
        </svg>
      )}

      {/* BPMN: 40x50 diamond with pentagon marker */}
      {isBpmn && (
        <svg width="40" height="50" viewBox="0 0 40 50">
          <polygon
            points="20,1 39,25 20,49 1,25"
            fill={GATEWAY_FILL}
            stroke={selected ? SELECTION_COLOR : GATEWAY_AMBER}
            strokeWidth={selected ? 2 : 1}
          />
          {/* Pentagon outline marker inside diamond */}
          <polygon points="20,13 28,18 26,28 14,28 12,18" fill="none" stroke={GATEWAY_AMBER} strokeWidth="1.5" />
        </svg>
      )}

      {/* ISA88: resizable horizontal single bar */}
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
              background: GATEWAY_AMBER,
              border: '1px solid #b45309',
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
              background: GATEWAY_AMBER,
              border: '1px solid #b45309',
              borderRadius: 1,
              cursor: 'ew-resize',
              zIndex: 10,
            }}
          />
          <svg width={isa88Width} height="40" viewBox={`0 0 ${isa88Width} 40`}>
            {/* Target stems: top to bar for each target handle */}
            {targetHandles.map((handleId, i) => {
              const x = ((i + 1) / (totalTargetHandles + 1)) * isa88Width
              return <line key={`s-${handleId}`} x1={x} y1={0} x2={x} y2={20} stroke={barStroke} strokeWidth={1} />
            })}
            {/* Default target stem (dashed) */}
            <line
              x1={(totalTargetHandles / (totalTargetHandles + 1)) * isa88Width}
              y1={0}
              x2={(totalTargetHandles / (totalTargetHandles + 1)) * isa88Width}
              y2={20}
              stroke={GATEWAY_AMBER}
              strokeWidth={0.5}
              strokeDasharray="2,2"
            />
            {/* Source stem: bar to bottom center */}
            <line x1={isa88Width / 2} y1={20} x2={isa88Width / 2} y2={40} stroke={barStroke} strokeWidth={1} />
            {/* Horizontal bar */}
            <line x1="1" y1="20" x2={isa88Width - 1} y2="20" stroke={barStroke} strokeWidth={selected ? 2 : 1.5} />
            <text x={isa88Width / 2} y="34" textAnchor="middle" fontSize="8" fontWeight="500" fill="#92400e">
              WAIT ANY
            </text>
          </svg>
        </div>
      )}

      {/* Flowchart: BAR target at top, circular source at bottom */}
      {notation === 'flowchart' && (
        <>
          <Handle
            type="target"
            position={Position.Top}
            className={cn(
              '!w-5 !h-2 !rounded-sm !bg-amber-500 !border !border-amber-700 transition-all',
              isValidTarget && '!ring-2 !ring-blue-500 !scale-110 !bg-blue-500',
            )}
          />
          <Handle
            type="source"
            position={Position.Bottom}
            className="!w-2 !h-2 !rounded-full !bg-amber-500 !border-2 !border-white"
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
              '!w-2 !h-2 !rounded-full !bg-amber-500 !border-2 !border-white transition-all',
              isValidTarget && '!ring-2 !ring-blue-500 !scale-125 !bg-blue-500',
            )}
          />
          <Handle
            type="source"
            position={Position.Right}
            style={{ top: 25 }}
            className="!w-2 !h-2 !rounded-full !bg-amber-500 !border-2 !border-white"
          />
        </>
      )}

      {/* ISA88: dynamic target handles at top, single source at bottom */}
      {notation === 'isa88' && (
        <>
          {targetHandles.map((handleId, i) => (
            <Handle
              key={handleId}
              type="target"
              position={Position.Top}
              id={handleId}
              style={{ left: `${((i + 1) / (totalTargetHandles + 1)) * 100}%` }}
              className={cn(
                '!w-2 !h-2 !rounded-full !bg-amber-500 !border-2 !border-white transition-all',
                isValidTarget && '!ring-2 !ring-blue-500 !scale-125 !bg-blue-500',
              )}
            />
          ))}
          {/* "New connection" default target handle */}
          <div
            className="absolute top-0 flex items-center justify-center"
            style={{
              left: `${(totalTargetHandles / (totalTargetHandles + 1)) * 100}%`,
              transform: 'translate(-50%, -50%)',
            }}
          >
            <Handle
              type="target"
              position={Position.Top}
              id="default"
              className={cn(
                '!relative !transform-none !left-auto !top-auto !w-2 !h-2 !rounded-full !bg-amber-400 !border !border-amber-600 transition-all',
                isValidTarget && '!ring-2 !ring-blue-500 !scale-125 !bg-blue-500',
              )}
            />
            <span className="absolute text-[8px] font-bold text-amber-800 leading-none pointer-events-none">+</span>
          </div>
          <Handle
            type="source"
            position={Position.Bottom}
            style={{ left: '50%' }}
            className="!w-2 !h-2 !rounded-full !bg-amber-500 !border-2 !border-white"
          />
        </>
      )}
    </div>
  )
})

WaitAnyNode.displayName = 'WaitAnyNode'
export default WaitAnyNode
