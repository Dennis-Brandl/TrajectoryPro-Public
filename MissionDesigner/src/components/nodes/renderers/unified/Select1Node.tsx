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
import type { StepNodeData, Select1OptionSpec } from '@/types/nodes'
import { getSyncAction } from '@/components/nodes/SyncBadge'
import { useNotationConfig } from '../shared/useNotationConfig'
import { SyncBadgeForNotation } from '../shared/SyncBadgeForNotation'
import { SELECTION_COLOR, GATEWAY_AMBER, GATEWAY_FILL } from '../shared/colors'
import { useIsa88Resize } from '../shared/useIsa88Resize'

type Select1NodeType = Node<StepNodeData, 'select1'>

/**
 * Unified Select 1 (exclusive choice) node for all 3 notations.
 * - Flowchart: 40x40 diamond with "Select 1" text
 * - BPMN: 20x30 diamond with X marker, text below
 * - ISA88: 40x20 horizontal single line with text above, dynamic source handles
 */
const Select1Node = memo(({ id, selected, data }: NodeProps<Select1NodeType>) => {
  const connection = useConnection()
  const isConnecting = connection.inProgress
  const isValidTarget = isConnecting

  const config = useNotationConfig()
  const { notation, inputPosition } = config

  const options = (data.select1Options || []) as Select1OptionSpec[]
  const totalHandles = options.length + 1
  const syncAction = getSyncAction(data)

  // Recalculate handle positions when dynamic source handles change
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => {
    updateNodeInternals([id])
  }, [options.length, id, updateNodeInternals])

  const isFlowchartOrIsa88 = notation === 'flowchart' || notation === 'isa88'
  const { width: isa88Width, xOffset, startResize } = useIsa88Resize(data)
  const isBpmn = notation === 'bpmn'

  // BPMN: spread source handles vertically across diamond height
  const bpmnDiamondHeight = 50

  const barStroke = selected ? SELECTION_COLOR : GATEWAY_AMBER

  return (
    <div
      className="relative"
      style={notation === 'isa88' && xOffset ? { transform: `translateX(${xOffset}px)` } : undefined}
    >
      {/* Flowchart: 60x60 diamond */}
      {notation === 'flowchart' && (
        <svg width="60" height="60" viewBox="0 0 60 60">
          <polygon
            points="30,1 59,30 30,59 1,30"
            fill={GATEWAY_FILL}
            stroke={selected ? SELECTION_COLOR : GATEWAY_AMBER}
            strokeWidth={selected ? 2 : 1}
          />
          <text x="30" y="27" textAnchor="middle" fontSize="8" fontWeight="500" fill="#92400e">
            Select
          </text>
          <text x="30" y="38" textAnchor="middle" fontSize="8" fontWeight="500" fill="#92400e">
            1
          </text>
        </svg>
      )}

      {/* BPMN: 40x50 diamond with X marker */}
      {isBpmn && (
        <svg width="40" height="50" viewBox="0 0 40 50">
          <polygon
            points="20,1 39,25 20,49 1,25"
            fill={GATEWAY_FILL}
            stroke={selected ? SELECTION_COLOR : GATEWAY_AMBER}
            strokeWidth={selected ? 2 : 1}
          />
          {/* X marker inside diamond */}
          <line x1="14" y1="19" x2="26" y2="31" stroke={GATEWAY_AMBER} strokeWidth="2" />
          <line x1="26" y1="19" x2="14" y2="31" stroke={GATEWAY_AMBER} strokeWidth="2" />
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
            {/* Target stem: center top to bar */}
            <line x1={isa88Width / 2} y1={0} x2={isa88Width / 2} y2={20} stroke={barStroke} strokeWidth={1} />
            {/* Source stems: bar to bottom for each option */}
            {options.map((opt, i) => {
              const x = ((i + 1) / (totalHandles + 1)) * isa88Width
              return <line key={`s-${opt.id}`} x1={x} y1={20} x2={x} y2={40} stroke={barStroke} strokeWidth={1} />
            })}
            {/* Default source stem (dashed) */}
            <line
              x1={(totalHandles / (totalHandles + 1)) * isa88Width}
              y1={20}
              x2={(totalHandles / (totalHandles + 1)) * isa88Width}
              y2={40}
              stroke={GATEWAY_AMBER}
              strokeWidth={0.5}
              strokeDasharray="2,2"
            />
            {/* Horizontal bar */}
            <line x1="1" y1="20" x2={isa88Width - 1} y2="20" stroke={barStroke} strokeWidth={selected ? 2 : 1.5} />
            <text x={isa88Width / 2} y="34" textAnchor="middle" fontSize="8" fontWeight="500" fill="#92400e">
              Select 1
            </text>
          </svg>
        </div>
      )}

      {/* Target handle — explicitly positioned per notation */}
      <Handle
        type="target"
        position={inputPosition}
        style={isBpmn ? { top: 25 } : notation === 'isa88' ? { left: '50%' } : undefined}
        className={cn(
          '!w-2 !h-2 !rounded-full !bg-amber-500 !border-2 !border-white transition-all',
          isValidTarget && '!ring-2 !ring-blue-500 !scale-125 !bg-blue-500',
        )}
      />

      {/* TB (flowchart/ISA88): source handles spread horizontally at bottom */}
      {isFlowchartOrIsa88 && (
        <>
          {options.map((opt, i) => (
            <Handle
              key={opt.id}
              type="source"
              position={Position.Bottom}
              id={opt.id}
              style={{ left: `${((i + 1) / (totalHandles + 1)) * 100}%` }}
              className="!w-2 !h-2 !rounded-full !bg-amber-500 !border-2 !border-white"
            />
          ))}
          {/* "New connection" default handle */}
          <div
            className="absolute bottom-0 flex items-center justify-center"
            style={{
              left: `${(totalHandles / (totalHandles + 1)) * 100}%`,
              transform: 'translate(-50%, 50%)',
            }}
          >
            <Handle
              type="source"
              position={Position.Bottom}
              id="default"
              className="!relative !transform-none !left-auto !top-auto !w-2 !h-2 !rounded-full !bg-amber-400 !border !border-amber-600"
            />
            <span className="absolute text-[8px] font-bold text-amber-800 leading-none pointer-events-none">+</span>
          </div>
        </>
      )}

      {/* LR (BPMN): source handles spread vertically on right */}
      {isBpmn && (
        <>
          {options.map((opt, i) => (
            <Handle
              key={opt.id}
              type="source"
              position={Position.Right}
              id={opt.id}
              style={{ top: ((i + 1) / (totalHandles + 1)) * bpmnDiamondHeight }}
              className="!w-2 !h-2 !rounded-full !bg-amber-500 !border-2 !border-white"
            />
          ))}
          {/* "New connection" default handle */}
          <div
            className="absolute right-0 flex items-center justify-center"
            style={{
              top: (totalHandles / (totalHandles + 1)) * bpmnDiamondHeight,
              transform: 'translate(50%, -50%)',
            }}
          >
            <Handle
              type="source"
              position={Position.Right}
              id="default"
              className="!relative !transform-none !left-auto !top-auto !w-2 !h-2 !rounded-full !bg-amber-400 !border !border-amber-600"
            />
            <span className="absolute text-[8px] font-bold text-amber-800 leading-none pointer-events-none">+</span>
          </div>
        </>
      )}

      {syncAction && <SyncBadgeForNotation notation={config.notation} action={syncAction} />}
    </div>
  )
})

Select1Node.displayName = 'Select1Node'
export default Select1Node
