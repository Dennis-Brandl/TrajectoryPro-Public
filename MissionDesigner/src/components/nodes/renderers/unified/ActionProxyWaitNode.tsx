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
import { AlertTriangle, Settings } from 'lucide-react'
import { cn } from '@mission/ui'
import type { StepNodeData } from '@/types/nodes'
import { getSyncAction } from '@/components/nodes/SyncBadge'
import { useActionProxySyncState } from '@/hooks/useActionProxySyncState'
import { useNotationConfig } from '../shared/useNotationConfig'
import { Chevrons } from '../shared/Chevrons'
import { StatusDot } from '../shared/StatusDot'
import { SyncBadgeForNotation } from '../shared/SyncBadgeForNotation'
import { SELECTION_COLOR, DEFAULT_STROKE, SELECTED_FILL } from '../shared/colors'

type ActionProxyWaitNodeType = Node<StepNodeData, 'actionProxyWait'>

/**
 * Unified Environment Action node for all 3 notations.
 * Reads notation config to set dimensions, handle positions, and chevron rendering.
 * Status dot: green if actionName is set, gray outline otherwise.
 * Gear icon at config.rect.iconPos (the UI step's Hand slot): amber while no action
 * is configured so unconfigured environment actions stand out, slate once configured.
 * Amber triangle at the top-right while the action's definition is out of sync with the node's copy.
 */
const ActionProxyWaitNode = memo(({ id, data, selected }: NodeProps<ActionProxyWaitNodeType>) => {
  const connection = useConnection()
  const isConnecting = connection.inProgress
  const isValidTarget = isConnecting && connection.fromNode?.id !== id

  const config = useNotationConfig()
  const { width, height, rx, labelSize, labelPx, iconPos, iconSize } = config.rect
  const { cx, cy, r } = config.rect.statusDot
  const syncAction = getSyncAction(data)
  const hasActionRef = !!data.actionName
  const { status: syncStatus } = useActionProxySyncState(data)

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
        <StatusDot cx={cx} cy={cy} r={r} active={hasActionRef} />
      </svg>
      {/* Gear icon positioned per notation config */}
      <div className="absolute" style={{ top: iconPos.top, left: iconPos.left }}>
        <Settings
          size={iconSize}
          className={hasActionRef ? 'text-slate-500' : 'text-amber-500'}
          strokeWidth={2}
          data-testid="env-action-gear"
        />
      </div>
      {/* Spec 2026-09-04 §6.4.1: the copied action signature no longer matches the action. */}
      {syncStatus === 'outdated' && (
        <div
          className="absolute -top-1 -right-1"
          title="Action definition changed — open the step to update"
          data-testid="env-action-outdated"
        >
          <AlertTriangle size={12} className="text-amber-500" strokeWidth={2.5} />
        </div>
      )}
      <div className={cn('absolute inset-0 flex items-center justify-center', labelPx)}>
        <span className={cn(labelSize, 'font-medium text-slate-700 line-clamp-2 text-center leading-tight')}>
          {data.label}
        </span>
      </div>
      <Handle
        type="target"
        position={config.inputPosition}
        className={cn(
          '!w-3 !h-3 !rounded-full !bg-slate-500 !border-2 !border-white transition-all',
          isValidTarget && '!ring-2 !ring-blue-500 !scale-125 !bg-blue-500',
        )}
      />
      <Handle
        type="source"
        position={config.outputPosition}
        className="!w-3 !h-3 !rounded-full !bg-slate-500 !border-2 !border-white"
      />
      {syncAction && <SyncBadgeForNotation notation={config.notation} action={syncAction} />}
    </div>
  )
})

ActionProxyWaitNode.displayName = 'ActionProxyWaitNode'
export default ActionProxyWaitNode
