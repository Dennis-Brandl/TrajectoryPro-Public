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
import type { StepNodeData, ResourceCommandType } from '@/types/nodes'

type SyncAction = 'Send' | 'Receive' | 'Synchronize'

const SYNC_COMMANDS: ResourceCommandType[] = ['Send', 'Receive', 'Synchronize']

/**
 * Scans a step's resourceCommands for a sync-type command.
 * Returns the action type if found, null otherwise.
 */
export function getSyncAction(data: StepNodeData): SyncAction | null {
  if (!data.resourceCommands) return null
  for (const cmd of data.resourceCommands) {
    if (SYNC_COMMANDS.includes(cmd.commandType)) {
      return cmd.commandType as SyncAction
    }
  }
  return null
}

interface SyncBadgeProps {
  action: SyncAction
}

/**
 * Flowchart sync badge: small vertical rect to the right of the node.
 * SEND: dashed arrow pointing right (away from node).
 * RECV: dashed arrow on right side pointing left (toward node).
 * SYNC: no arrow.
 */
export const FlowchartSyncBadge = memo(({ action }: SyncBadgeProps) => {
  const label = action === 'Send' ? 'SEND' : action === 'Receive' ? 'RECV' : 'SYNC'
  return (
    <div style={{ position: 'absolute', right: -8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
      <svg width="10" height="20" viewBox="0 0 10 20">
        <rect x="1" y="1" width="8" height="18" rx="1" fill="white" stroke="#64748b" strokeWidth="0.75" />
        <text
          x="5"
          y="10"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="3"
          fontWeight="bold"
          fill="#475569"
          transform="rotate(90 5 10)"
        >
          {label}
        </text>
      </svg>
      {action === 'Send' && (
        <svg
          width="8"
          height="5"
          viewBox="0 0 8 5"
          style={{ position: 'absolute', right: -8, top: '50%', transform: 'translateY(-50%)' }}
        >
          <line x1="0" y1="2.5" x2="5" y2="2.5" stroke="#64748b" strokeWidth="0.75" strokeDasharray="2 1" />
          <polygon points="5,1 8,2.5 5,4" fill="#64748b" />
        </svg>
      )}
      {action === 'Receive' && (
        <svg
          width="8"
          height="5"
          viewBox="0 0 8 5"
          style={{ position: 'absolute', right: -8, top: '50%', transform: 'translateY(-50%)' }}
        >
          <line x1="3" y1="2.5" x2="8" y2="2.5" stroke="#64748b" strokeWidth="0.75" strokeDasharray="2 1" />
          <polygon points="3,1 0,2.5 3,4" fill="#64748b" />
        </svg>
      )}
    </div>
  )
})
FlowchartSyncBadge.displayName = 'FlowchartSyncBadge'

/**
 * BPMN sync badge: small horizontal rect below the node.
 * SEND: dashed arrow pointing down (away from node).
 * RECV: dashed arrow below badge pointing up (toward node).
 * SYNC: no arrow.
 */
export const BpmnSyncBadge = memo(({ action }: SyncBadgeProps) => {
  const label = action === 'Send' ? 'SEND' : action === 'Receive' ? 'RECV' : 'SYNC'
  return (
    <div
      style={{ position: 'absolute', bottom: -8, left: '50%', transform: 'translateX(-50%)', pointerEvents: 'none' }}
    >
      <svg width="24" height="10" viewBox="0 0 24 10">
        <rect x="1" y="1" width="22" height="8" rx="1" fill="white" stroke="#64748b" strokeWidth="0.75" />
        <text x="12" y="5" textAnchor="middle" dominantBaseline="central" fontSize="4" fontWeight="bold" fill="#475569">
          {label}
        </text>
      </svg>
      {action === 'Send' && (
        <svg
          width="5"
          height="8"
          viewBox="0 0 5 8"
          style={{ position: 'absolute', bottom: -8, left: '50%', transform: 'translateX(-50%)' }}
        >
          <line x1="2.5" y1="0" x2="2.5" y2="5" stroke="#64748b" strokeWidth="0.75" strokeDasharray="2 1" />
          <polygon points="1,5 2.5,8 4,5" fill="#64748b" />
        </svg>
      )}
      {action === 'Receive' && (
        <svg
          width="5"
          height="8"
          viewBox="0 0 5 8"
          style={{ position: 'absolute', bottom: -8, left: '50%', transform: 'translateX(-50%)' }}
        >
          <line x1="2.5" y1="3" x2="2.5" y2="8" stroke="#64748b" strokeWidth="0.75" strokeDasharray="2 1" />
          <polygon points="1,3 2.5,0 4,3" fill="#64748b" />
        </svg>
      )}
    </div>
  )
})
BpmnSyncBadge.displayName = 'BpmnSyncBadge'

/**
 * ISA 88 sync badge: action qualifier rectangle on the right side.
 * S = Send with right-pointing dashed arrow.
 * R = Receive with left-pointing dashed arrow.
 * S = Synchronize with double-headed arrow (bidirectional).
 */
export const Isa88SyncBadge = memo(({ action }: SyncBadgeProps) => {
  const label = action === 'Synchronize' ? 'S' : action === 'Send' ? 'S' : 'R'
  return (
    <div style={{ position: 'absolute', right: -10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
      <svg width="12" height="14" viewBox="0 0 12 14">
        <rect x="1" y="1" width="10" height="12" fill="white" stroke="#64748b" strokeWidth="0.75" />
        <text x="6" y="7" textAnchor="middle" dominantBaseline="central" fontSize="6" fontWeight="bold" fill="#475569">
          {label}
        </text>
      </svg>
      {action === 'Send' && (
        <svg
          width="8"
          height="5"
          viewBox="0 0 8 5"
          style={{ position: 'absolute', right: -8, top: '50%', transform: 'translateY(-50%)' }}
        >
          <line x1="0" y1="2.5" x2="5" y2="2.5" stroke="#64748b" strokeWidth="0.75" strokeDasharray="2 1" />
          <polygon points="5,1 8,2.5 5,4" fill="#64748b" />
        </svg>
      )}
      {action === 'Receive' && (
        <svg
          width="8"
          height="5"
          viewBox="0 0 8 5"
          style={{ position: 'absolute', right: -8, top: '50%', transform: 'translateY(-50%)' }}
        >
          <line x1="3" y1="2.5" x2="8" y2="2.5" stroke="#64748b" strokeWidth="0.75" strokeDasharray="2 1" />
          <polygon points="3,1 0,2.5 3,4" fill="#64748b" />
        </svg>
      )}
      {action === 'Synchronize' && (
        <svg
          width="14"
          height="5"
          viewBox="0 0 14 5"
          style={{ position: 'absolute', right: -14, top: '50%', transform: 'translateY(-50%)' }}
        >
          <line x1="3" y1="2.5" x2="11" y2="2.5" stroke="#64748b" strokeWidth="0.75" strokeDasharray="2 1" />
          <polygon points="3,1 0,2.5 3,4" fill="#64748b" />
          <polygon points="11,1 14,2.5 11,4" fill="#64748b" />
        </svg>
      )}
    </div>
  )
})
Isa88SyncBadge.displayName = 'Isa88SyncBadge'
