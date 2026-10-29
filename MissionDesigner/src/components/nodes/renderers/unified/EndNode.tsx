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
import { Handle, useConnection, type NodeProps, type Node } from '@xyflow/react'
import { cn } from '@mission/ui'
import type { StepNodeData } from '@/types/nodes'
import { useNotationConfig } from '../shared/useNotationConfig'
import { EditableLabel } from '@/components/nodes/EditableLabel'
import { SELECTION_COLOR, END_COLOR, END_FILL } from '../shared/colors'

type EndNodeType = Node<StepNodeData, 'end'>

/**
 * Unified End node for all 3 notations.
 * - Flowchart: filled red circle
 * - BPMN: thick-border circle (BPMN 2.0 end event, strokeWidth always 2)
 * - ISA88: triangle (point at top), label below SVG
 */
const EndNode = memo(({ id, data, selected }: NodeProps<EndNodeType>) => {
  const connection = useConnection()
  const isConnecting = connection.inProgress
  const isValidTarget = isConnecting && connection.fromNode?.id !== id

  const config = useNotationConfig()
  const { notation, inputPosition, startEnd } = config
  const strokeColor = selected ? SELECTION_COLOR : END_COLOR

  return (
    <div className="relative">
      {notation === 'flowchart' && (
        <>
          <svg width="30" height="30" viewBox="0 0 30 30">
            <circle cx="15" cy="15" r="13" fill={END_FILL} stroke={strokeColor} strokeWidth={selected ? 2 : 1} />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <EditableLabel
              nodeId={id}
              label={data.label}
              className={cn(startEnd.labelSize, 'font-semibold text-red-800')}
            />
          </div>
        </>
      )}

      {notation === 'bpmn' && (
        <>
          <svg width="30" height="30" viewBox="0 0 30 30">
            <circle cx="15" cy="15" r="12" fill="white" stroke={strokeColor} strokeWidth={2} />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <EditableLabel
              nodeId={id}
              label={data.label}
              className={cn(startEnd.labelSize, 'font-semibold text-red-800')}
            />
          </div>
        </>
      )}

      {notation === 'isa88' && (
        <>
          <svg width="30" height="30" viewBox="0 0 30 30">
            <polygon
              points="15,3 2,27 28,27"
              fill={END_FILL}
              stroke={strokeColor}
              strokeWidth={selected ? 2 : 1}
              strokeLinejoin="round"
            />
          </svg>
          <div className="absolute left-0 right-0 flex justify-center" style={{ bottom: -14 }}>
            <EditableLabel
              nodeId={id}
              label={data.label}
              className={cn(startEnd.labelSize, 'font-semibold text-red-800')}
            />
          </div>
        </>
      )}

      {/* END: only incoming connection */}
      <Handle
        type="target"
        position={inputPosition}
        className={cn(
          '!w-2 !h-2 !rounded-full !bg-red-500 !border-2 !border-white transition-all',
          isValidTarget && '!ring-2 !ring-blue-500 !scale-125 !bg-blue-500',
        )}
      />
    </div>
  )
})

EndNode.displayName = 'EndNode'
export default EndNode
