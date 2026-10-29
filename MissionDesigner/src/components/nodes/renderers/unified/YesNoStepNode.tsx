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

import { memo } from 'react'
import { Handle, Position, useConnection, type NodeProps, type Node } from '@xyflow/react'
import { cn } from '@mission/ui'
import type { StepNodeData } from '@/types/nodes'
import { getSyncAction } from '@/components/nodes/SyncBadge'
import { isFormDesigned } from '@/lib/form-document/is-form-designed'
import { useNotationConfig } from '../shared/useNotationConfig'
import { SyncBadgeForNotation } from '../shared/SyncBadgeForNotation'
import { Chevrons } from '../shared/Chevrons'
import { StatusDot } from '../shared/StatusDot'
import { SELECTION_COLOR, DEFAULT_STROKE, START_COLOR, END_COLOR, SELECTED_FILL } from '../shared/colors'

type YesNoStepNodeType = Node<StepNodeData, 'yesNoStep'>

/**
 * Unified Yes/No Step node for all 3 notations.
 * Same rect shape as other rect nodes, but with two output handles (yes/no).
 * Split circle icon varies by notation. Handle layout varies by flow direction.
 */
const YesNoStepNode = memo(({ id, data, selected }: NodeProps<YesNoStepNodeType>) => {
  const connection = useConnection()
  const isConnecting = connection.inProgress
  const isValidTarget = isConnecting && connection.fromNode?.id !== id

  const config = useNotationConfig()
  const { notation, inputPosition } = config
  const { width, height, rx, labelSize, labelPx } = config.rect
  const { cx, cy, r } = config.rect.statusDot

  const displayLabel = data.label || 'Yes/No'
  const yesNoBlock = data.uiParameters?.find((p) => p.type === 'YesNoButtons')
  const yesLabel = yesNoBlock?.value || 'Yes'
  const noLabel = ('value2' in (yesNoBlock || {}) ? (yesNoBlock as { value2: string }).value2 : undefined) || 'No'
  const syncAction = getSyncAction(data)

  const isDesigned = isFormDesigned(data)

  const isTB = notation === 'flowchart' || notation === 'isa88'
  const isFlowchart = notation === 'flowchart'
  const isBpmn = notation === 'bpmn'

  return (
    <div className="relative">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <rect
          x="1"
          y="1"
          width={width - 2}
          height={height - 2}
          rx={rx}
          fill={selected ? SELECTED_FILL : 'white'}
          stroke={selected ? SELECTION_COLOR : DEFAULT_STROKE}
          strokeWidth={selected ? 2 : 1}
        />
        {config.hasChevrons && <Chevrons />}
        <StatusDot cx={cx} cy={cy} r={r} active={isDesigned} />

        {/* Split circle icon — flowchart */}
        {isFlowchart && (
          <>
            <path d="M10,5 A4,4 0 0,0 10,13" fill={START_COLOR} />
            <path d="M10,5 A4,4 0 0,1 10,13" fill={END_COLOR} />
            <circle cx="10" cy="9" r="4" fill="none" stroke={DEFAULT_STROKE} strokeWidth="0.5" />
          </>
        )}

        {/* Split circle icon — BPMN */}
        {isBpmn && (
          <>
            <path d="M12,8 A4,4 0 0,0 12,16" fill={START_COLOR} />
            <path d="M12,8 A4,4 0 0,1 12,16" fill={END_COLOR} />
            <circle cx="12" cy="12" r="4" fill="none" stroke={DEFAULT_STROKE} strokeWidth="0.5" />
          </>
        )}

        {/* Split circle icon — ISA88 (after chevron area) */}
        {notation === 'isa88' && (
          <>
            <path d="M32,6 A5,5 0 0,0 32,16" fill={START_COLOR} />
            <path d="M32,6 A5,5 0 0,1 32,16" fill={END_COLOR} />
            <circle cx="32" cy="11" r="5" fill="none" stroke={DEFAULT_STROKE} strokeWidth="0.5" />
          </>
        )}
      </svg>

      <div className={cn('absolute inset-0 flex items-center justify-center z-10', labelPx)}>
        <span className={cn(labelSize, 'font-medium text-slate-700 line-clamp-2 text-center leading-tight')}>
          {displayLabel}
        </span>
      </div>

      {/* Input handle */}
      <Handle
        type="target"
        position={inputPosition}
        className={cn(
          '!w-3 !h-3 !rounded-full !bg-slate-500 !border-2 !border-white transition-all',
          isValidTarget && '!ring-2 !ring-blue-500 !scale-125 !bg-blue-500',
        )}
      />

      {/* TB (flowchart/ISA88): yes/no handles at bottom, spread left/right */}
      {isTB && (
        <>
          <Handle
            type="source"
            position={Position.Bottom}
            id="yes"
            style={{ left: isFlowchart ? 40 : 43 }}
            className="!w-3 !h-3 !rounded-full !bg-green-500 !border-2 !border-white"
          />
          <span
            className="absolute text-[8px] text-green-700 font-medium"
            style={{ bottom: -14, left: isFlowchart ? 40 : 43, transform: 'translateX(-50%)' }}
          >
            {yesLabel}
          </span>
          <Handle
            type="source"
            position={Position.Bottom}
            id="no"
            style={{ left: isFlowchart ? 80 : 87 }}
            className="!w-3 !h-3 !rounded-full !bg-red-500 !border-2 !border-white"
          />
          <span
            className="absolute text-[8px] text-red-700 font-medium"
            style={{ bottom: -14, left: isFlowchart ? 80 : 87, transform: 'translateX(-50%)' }}
          >
            {noLabel}
          </span>
        </>
      )}

      {/* LR (BPMN): yes/no handles on right, spread top/bottom */}
      {isBpmn && (
        <>
          <Handle
            type="source"
            position={Position.Right}
            id="yes"
            style={{ top: 20 }}
            className="!w-3 !h-3 !rounded-full !bg-green-500 !border-2 !border-white"
          />
          <span
            className="absolute text-[8px] text-green-700 font-medium"
            style={{ top: 20, right: -22, transform: 'translateY(-50%)' }}
          >
            {yesLabel}
          </span>
          <Handle
            type="source"
            position={Position.Right}
            id="no"
            style={{ top: 40 }}
            className="!w-3 !h-3 !rounded-full !bg-red-500 !border-2 !border-white"
          />
          <span
            className="absolute text-[8px] text-red-700 font-medium"
            style={{ top: 40, right: -18, transform: 'translateY(-50%)' }}
          >
            {noLabel}
          </span>
        </>
      )}

      {syncAction && <SyncBadgeForNotation notation={config.notation} action={syncAction} />}
    </div>
  )
})

YesNoStepNode.displayName = 'YesNoStepNode'
export default YesNoStepNode
