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

type ReturnNodeType = Node<StepNodeData, 'return'>
const RETURN_FILL = '#ffccbc'
const RETURN_STROKE = '#bf360c'

/**
 * Unified RETURN node: a 30x30 narrow-top trapezoid, same footprint as START/END.
 * BPMN rotates the shape 90 deg CCW for left->right flow (narrow-left, in on the
 * left -> wide-right). RETURN has only an incoming handle.
 */
const ReturnNode = memo(({ id, data, selected }: NodeProps<ReturnNodeType>) => {
  const { notation, inputPosition, startEnd } = useNotationConfig()
  const stroke = selected ? SELECTION_COLOR : RETURN_STROKE
  const rotate = notation === 'bpmn' ? 'rotate(-90 15 15)' : undefined
  return (
    <div className="relative" style={{ width: 30, height: 30 }}>
      <svg width="30" height="30" viewBox="0 0 30 30" className="absolute inset-0">
        <polygon
          points="7,0 23,0 30,30 0,30"
          fill={RETURN_FILL}
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
          className={cn(startEnd.labelSize, 'font-semibold text-orange-950')}
        />
      </div>
      {data.returnConfig?.command && (
        <span
          className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] font-mono text-orange-900"
          style={{ top: 32 }}
        >
          {data.returnConfig.command}
        </span>
      )}
      <Handle
        type="target"
        position={inputPosition}
        className="!w-2 !h-2 !rounded-full !bg-orange-800 !border-2 !border-white"
      />
    </div>
  )
})
ReturnNode.displayName = 'ReturnNode'
export default ReturnNode
