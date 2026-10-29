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
import { Handle, type NodeProps, type Node } from '@xyflow/react'
import { cn } from '@mission/ui'
import type { StepNodeData } from '@/types/nodes'
import { useNotationConfig } from '../shared/useNotationConfig'
import { EditableLabel } from '@/components/nodes/EditableLabel'
import { SELECTION_COLOR } from '../shared/colors'

type CatchNodeType = Node<StepNodeData, 'catch'>
const CATCH_FILL = '#ffe0b2'
const CATCH_STROKE = '#e65100'

/**
 * Unified CATCH node: a 30x30 wide-top trapezoid ("funnel"), same footprint as
 * START/END. BPMN rotates the shape 90 deg CCW so the funnel suits left->right
 * flow (wide-left -> narrow-right, exit on the right). CATCH has only an
 * outgoing handle.
 */
const CatchNode = memo(({ id, data, selected }: NodeProps<CatchNodeType>) => {
  const { notation, outputPosition, startEnd } = useNotationConfig()
  const stroke = selected ? SELECTION_COLOR : CATCH_STROKE
  const rotate = notation === 'bpmn' ? 'rotate(-90 15 15)' : undefined
  return (
    <div className="relative" style={{ width: 30, height: 30 }}>
      <svg width="30" height="30" viewBox="0 0 30 30" className="absolute inset-0">
        <polygon
          points="0,0 30,0 23,30 7,30"
          fill={CATCH_FILL}
          stroke={stroke}
          strokeWidth={selected ? 2 : 1}
          strokeLinejoin="round"
          transform={rotate}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <EditableLabel
          nodeId={id}
          label={data.label}
          className={cn(startEnd.labelSize, 'font-semibold text-orange-900')}
        />
      </div>
      {data.catchId && (
        <span
          className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] font-mono text-orange-800"
          style={{ top: 32 }}
        >
          {data.catchId}
        </span>
      )}
      <Handle
        type="source"
        position={outputPosition}
        className="!w-2 !h-2 !rounded-full !bg-orange-700 !border-2 !border-white"
      />
    </div>
  )
})
CatchNode.displayName = 'CatchNode'
export default CatchNode
