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
import { useNotationConfig } from '../shared/useNotationConfig'
import { SyncBadgeForNotation } from '../shared/SyncBadgeForNotation'
import { SELECTION_COLOR, GATEWAY_AMBER, GATEWAY_FILL } from '../shared/colors'

type GateNodeType = Node<StepNodeData, 'gateStep'>

/** Timed GATE mark (spec 2026-10-13 §4.4): clock face + hour and minute hands. */
function ClockMark({ cx, cy, r, color }: { cx: number; cy: number; r: number; color: string }) {
  return (
    <g data-testid="gate-clock">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={1} />
      <line x1={cx} y1={cy} x2={cx} y2={cy - r * 0.7} stroke={color} strokeWidth={1} />
      <line x1={cx} y1={cy} x2={cx + r * 0.6} y2={cy} stroke={color} strokeWidth={1} />
    </g>
  )
}

/**
 * Unified Gate node (spec 2026-08-29 §8.3, symbols amended 2026-08-30) — the first step type
 * whose SHAPE differs per notation: ISA-88 = a narrow double bar with thin centre-line stems
 * (the classic SFC transition mark), no text; flowchart = 60×60 diamond with two HORIZONTAL
 * parallel lines plus a "GATE" label inside the shape; BPMN = 40×50 diamond with two VERTICAL
 * parallel lines plus a "GATE" label inside the shape. No external step-name label is rendered
 * in any notation (matches the Select1Node gateway convention). One target, one source handle.
 * Timed gates (spec 2026-10-13) add a small clock mark.
 */
const GateNode = memo(({ id, data, selected }: NodeProps<GateNodeType>) => {
  const connection = useConnection()
  const isValidTarget = connection.inProgress && connection.fromNode?.id !== id
  const config = useNotationConfig()
  const notation = config.notation
  const syncAction = getSyncAction(data)
  const stroke = selected ? SELECTION_COLOR : GATEWAY_AMBER
  const timed = data.gateMode === 'timer' || data.gateMode === 'condition_or_timer'

  return (
    <div className="relative">
      {notation === 'flowchart' && (
        <svg width="60" height="60" viewBox="0 0 60 60">
          <polygon points="30,1 59,30 30,59 1,30" fill={GATEWAY_FILL} stroke={stroke} strokeWidth={selected ? 2 : 1} />
          {/* Parallel lines shifted into the upper half, GATE label inside the diamond below them */}
          <line x1="18" y1="22" x2="42" y2="22" stroke={GATEWAY_AMBER} strokeWidth="2" />
          <line x1="18" y1="29" x2="42" y2="29" stroke={GATEWAY_AMBER} strokeWidth="2" />
          <text x="30" y="42" fontSize="8" textAnchor="middle" fill="#78350f" fontWeight="600">
            GATE
          </text>
          {timed && <ClockMark cx={30} cy={12} r={4} color="#78350f" />}
        </svg>
      )}
      {notation === 'bpmn' && (
        <svg width="40" height="50" viewBox="0 0 40 50">
          <polygon points="20,1 39,25 20,49 1,25" fill={GATEWAY_FILL} stroke={stroke} strokeWidth={selected ? 2 : 1} />
          {/* Parallel lines shortened/raised, GATE label inside the diamond below them.
              The diamond narrows fast below center; font-size kept at 6 (not the 7 in the
              original suggestion) so "GATE" stays comfortably inside the ≈22px inscribed
              width at the y=35 baseline. */}
          <line x1="16" y1="10" x2="16" y2="22" stroke={GATEWAY_AMBER} strokeWidth="2" />
          <line x1="24" y1="10" x2="24" y2="22" stroke={GATEWAY_AMBER} strokeWidth="2" />
          <text x="20" y="35" fontSize="6" textAnchor="middle" fill="#78350f" fontWeight="600">
            GATE
          </text>
          {timed && <ClockMark cx={20} cy={42} r={3} color="#78350f" />}
        </svg>
      )}
      {notation === 'isa88' && (
        <svg width="60" height="24" viewBox="0 0 60 24">
          {/* Two short parallel horizontal lines, minimal gap — the ISA-88 transition mark */}
          <line x1="10" y1="9" x2="50" y2="9" stroke={stroke} strokeWidth={selected ? 3 : 2} />
          <line x1="10" y1="15" x2="50" y2="15" stroke={stroke} strokeWidth={selected ? 3 : 2} />
          {/* Thin centre-line stems connecting the bars to the top/bottom connection points —
              the classic SFC transition mark. No text at this size (illegible). */}
          <line x1="30" y1="0" x2="30" y2="9" stroke={stroke} strokeWidth={1} />
          <line x1="30" y1="15" x2="30" y2="24" stroke={stroke} strokeWidth={1} />
          {timed && <ClockMark cx={56} cy={12} r={3.5} color={stroke} />}
        </svg>
      )}
      <Handle
        type="target"
        position={notation === 'bpmn' ? Position.Left : Position.Top}
        className={cn(
          '!w-2 !h-2 !rounded-full !bg-amber-500 !border-2 !border-white transition-all',
          isValidTarget && '!ring-2 !ring-blue-500 !scale-125 !bg-blue-500',
        )}
      />
      <Handle
        type="source"
        position={notation === 'bpmn' ? Position.Right : Position.Bottom}
        className="!w-2 !h-2 !rounded-full !bg-amber-500 !border-2 !border-white"
      />
      {syncAction && <SyncBadgeForNotation notation={notation} action={syncAction} />}
    </div>
  )
})

GateNode.displayName = 'GateNode'
export default GateNode
