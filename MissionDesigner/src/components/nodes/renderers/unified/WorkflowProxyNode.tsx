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
import { Link2, FileBox, GitBranch, Workflow } from 'lucide-react'
import { cn } from '@mission/ui'
import type { StepNodeData } from '@/types/nodes'
import { getSyncAction } from '@/components/nodes/SyncBadge'
import { useNotationConfig } from '../shared/useNotationConfig'
import { useIsChildWorkflow } from '@/hooks/useIsChildWorkflow'
import { SyncBadgeForNotation } from '../shared/SyncBadgeForNotation'
import { SELECTION_COLOR, DEFAULT_STROKE, SELECTED_FILL } from '../shared/colors'

type WorkflowProxyNodeType = Node<StepNodeData, 'workflowProxy'>

/**
 * Unified Workflow Proxy node for all 3 notations.
 *
 * Notation differences:
 * - Flowchart: double-outline inner rect, mode icon only when mode is set, slate handles
 * - BPMN: always shows mode icon (GitBranch fallback), thicker stroke, slate handles
 * - ISA88: sky-blue stroke and chevrons, sky-500 handles, sky-700 label, Workflow fallback icon
 */
const WorkflowProxyNode = memo(({ id, data, selected }: NodeProps<WorkflowProxyNodeType>) => {
  const connection = useConnection()
  const isConnecting = connection.inProgress
  const isValidTarget = isConnecting && connection.fromNode?.id !== id

  const config = useNotationConfig()
  const { width, height, rx, labelSize, labelPx } = config.rect
  const isChild = useIsChildWorkflow()

  const isReference = data.subWorkflowMode === 'reference'
  const defaultFill = isReference ? '#f1f5f9' : 'white'
  const fill = selected ? SELECTED_FILL : defaultFill
  const syncAction = getSyncAction(data)

  const isIsa88 = config.notation === 'isa88'
  const isBpmn = config.notation === 'bpmn'
  const isFlowchart = config.notation === 'flowchart'

  // Stroke color: ISA88 uses sky blue, others use slate or selected blue
  const strokeColor = selected ? SELECTION_COLOR : isIsa88 ? '#0ea5e9' : DEFAULT_STROKE
  // BPMN uses strokeWidth=2 always (Call Activity visual weight); others use 1 unselected / 2 selected
  const strokeWidth = isBpmn ? 2 : selected ? 2 : 1

  // Mode indicator icon selection:
  // - ISA88 fallback: Workflow (sky)
  // - BPMN fallback: GitBranch (slate) — always shown
  // - Flowchart: null when no mode set — icon hidden
  let ModeIcon: typeof Link2 | typeof FileBox | typeof GitBranch | typeof Workflow | null = null
  let iconColor = ''
  if (data.subWorkflowMode === 'reference') {
    ModeIcon = Link2
    iconColor = 'text-green-500'
  } else if (data.subWorkflowMode === 'embedded') {
    ModeIcon = FileBox
    iconColor = 'text-blue-500'
  } else if (isIsa88) {
    ModeIcon = Workflow
    iconColor = 'text-sky-500'
  } else if (isBpmn) {
    ModeIcon = GitBranch
    iconColor = 'text-slate-500'
  }
  // Flowchart: ModeIcon remains null when no mode set

  // Handle styling: ISA88 uses sky-500, others use slate-500
  const handleBase = isIsa88
    ? '!w-3 !h-3 !rounded-full !bg-sky-500 !border-2 !border-white'
    : '!w-3 !h-3 !rounded-full !bg-slate-500 !border-2 !border-white'

  // BPMN rect is inset by 1 extra px (x=2,y=2) to accommodate thicker stroke
  const rectInset = isBpmn ? 2 : 1
  const rectW = width - rectInset * 2
  const rectH = height - rectInset * 2

  return (
    <div className="relative">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <rect
          x={rectInset}
          y={rectInset}
          width={rectW}
          height={rectH}
          rx={rx}
          fill={fill}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
        />
        {/* Flowchart only: inner double-outline rect */}
        {isFlowchart && (
          <rect
            x="5"
            y="5"
            width={width - 10}
            height={height - 10}
            rx="2"
            fill="none"
            stroke={selected ? SELECTION_COLOR : DEFAULT_STROKE}
            strokeWidth="0.5"
          />
        )}
        {/* ISA88: sky-blue chevrons (custom color, not using shared Chevrons) */}
        {isIsa88 && (
          <>
            <line x1="2" y1="12" x2="12" y2="2" stroke="#0ea5e9" strokeWidth="1" />
            {isChild && <line x1="2" y1="20" x2="20" y2="2" stroke="#0ea5e9" strokeWidth="1" />}
          </>
        )}
      </svg>
      {/* Mode indicator icon: top-right corner */}
      {ModeIcon && (
        <ModeIcon
          className={cn('absolute top-[3px] right-[3px]', isFlowchart ? 'w-2 h-2' : 'w-[9px] h-[9px]', iconColor)}
        />
      )}
      <div className={cn('absolute inset-0 flex items-center justify-center', labelPx)}>
        <span
          className={cn(
            labelSize,
            'font-medium line-clamp-2 text-center leading-tight',
            isIsa88 ? 'text-sky-700' : 'text-slate-700',
          )}
        >
          {data.label}
        </span>
      </div>
      <Handle
        type="target"
        position={config.inputPosition}
        className={cn(handleBase, 'transition-all', isValidTarget && '!ring-2 !ring-blue-500 !scale-125 !bg-blue-500')}
      />
      <Handle type="source" position={config.outputPosition} className={handleBase} />
      {syncAction && <SyncBadgeForNotation notation={config.notation} action={syncAction} />}
    </div>
  )
})

WorkflowProxyNode.displayName = 'WorkflowProxyNode'
export default WorkflowProxyNode
