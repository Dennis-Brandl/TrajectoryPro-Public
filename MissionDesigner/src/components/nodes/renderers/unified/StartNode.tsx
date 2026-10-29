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
import { SELECTION_COLOR, START_COLOR, START_FILL } from '../shared/colors'

type StartNodeType = Node<StepNodeData, 'start'>

/**
 * Unified Start node for all 3 notations.
 * - Flowchart: filled green circle
 * - BPMN: thin-border circle (BPMN 2.0 start event)
 * - ISA88: upside-down triangle (point at bottom), label above SVG
 */
const StartNode = memo(({ id, data, selected }: NodeProps<StartNodeType>) => {
  const config = useNotationConfig()
  const { notation, outputPosition, startEnd } = config
  const strokeColor = selected ? SELECTION_COLOR : START_COLOR
  const strokeWidth = selected ? 2 : 1

  return (
    <div className="relative">
      {notation === 'flowchart' && (
        <>
          <svg width="30" height="30" viewBox="0 0 30 30">
            <circle cx="15" cy="15" r="13" fill={START_FILL} stroke={strokeColor} strokeWidth={strokeWidth} />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <EditableLabel
              nodeId={id}
              label={data.label}
              className={cn(startEnd.labelSize, 'font-semibold text-green-800')}
            />
          </div>
        </>
      )}

      {notation === 'bpmn' && (
        <>
          <svg width="30" height="30" viewBox="0 0 30 30">
            <circle cx="15" cy="15" r="12" fill="white" stroke={strokeColor} strokeWidth={strokeWidth} />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <EditableLabel
              nodeId={id}
              label={data.label}
              className={cn(startEnd.labelSize, 'font-semibold text-green-800')}
            />
          </div>
        </>
      )}

      {notation === 'isa88' && (
        <>
          <div className="absolute left-0 right-0 flex justify-center" style={{ top: -14 }}>
            <EditableLabel
              nodeId={id}
              label={data.label}
              className={cn(startEnd.labelSize, 'font-semibold text-green-800')}
            />
          </div>
          <svg width="30" height="30" viewBox="0 0 30 30">
            <polygon
              points="15,27 2,3 28,3"
              fill={START_FILL}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
              strokeLinejoin="round"
            />
          </svg>
        </>
      )}

      {/* START: only outgoing connection */}
      <Handle
        type="source"
        position={outputPosition}
        className="!w-2 !h-2 !rounded-full !bg-green-500 !border-2 !border-white"
      />
    </div>
  )
})

StartNode.displayName = 'StartNode'
export default StartNode
