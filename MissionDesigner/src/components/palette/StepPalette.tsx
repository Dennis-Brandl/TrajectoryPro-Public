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

import { memo, useCallback, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { ChevronLeft, ChevronRight, GripVertical } from 'lucide-react'
import { useNotationStore } from '@/stores/notationStore'
import { useFlowStore } from '@/stores/flowStore'
import { useCanEditActiveSpec } from '@/hooks/useCanEditActiveSpec'
import { generateOID, WORKER_STEP } from '@/lib/snowflake'
import { defaultStepData } from '@/lib/default-step-data'
import type { NodeType } from '@/types/nodes'
import type { Notation } from '@/types/notation'

export interface StepTypeItem {
  type: NodeType
  label: string
}

/**
 * Complete step type metadata — used by search, tests, and external references.
 */
export const stepTypes: StepTypeItem[] = [
  { type: 'start', label: 'Start' },
  { type: 'end', label: 'End' },
  { type: 'actionProxyWait', label: 'Environment Action' },
  { type: 'userInteractionStep', label: 'User Interaction' },
  { type: 'yesNoStep', label: 'Yes/No' },
  { type: 'scriptStep', label: 'Script' },
  { type: 'workflowProxy', label: 'Child Workflow' },
  { type: 'gateStep', label: 'Gate' },
  { type: 'select1', label: 'Select 1' },
  { type: 'waitAny', label: 'Wait Any' },
  { type: 'parallel', label: 'Parallel' },
  { type: 'waitAll', label: 'Wait All' },
  { type: 'catch', label: 'Catch' },
  { type: 'return', label: 'Return' },
]

// All palette step types in display order
const allStepTypes: StepTypeItem[] = [
  { type: 'start', label: 'Start' },
  { type: 'end', label: 'End' },
  { type: 'actionProxyWait', label: 'Environment Action' },
  { type: 'userInteractionStep', label: 'User Interaction' },
  { type: 'yesNoStep', label: 'Yes/No' },
  { type: 'scriptStep', label: 'Script' },
  { type: 'workflowProxy', label: 'Child Workflow' },
  { type: 'gateStep', label: 'Gate' },
  { type: 'select1', label: 'Select 1' },
  { type: 'waitAny', label: 'Wait Any' },
  { type: 'parallel', label: 'Parallel' },
  { type: 'waitAll', label: 'Wait All' },
  { type: 'catch', label: 'Catch' },
  { type: 'return', label: 'Return' },
]

/**
 * Notation-specific symbol component for palette items.
 */
export function NotationSymbol({ type, notation }: { type: NodeType; notation: Notation }) {
  // CATCH / RETURN — mini trapezoids matching the canvas nodes (CatchNode/ReturnNode).
  // The shape is identical across notations; BPMN rotates it 90deg CCW for left->right flow.
  if (type === 'catch' || type === 'return') {
    const isCatch = type === 'catch'
    // Editor node polygons are 30x30; scaled here to a 24x24 palette viewBox (x0.8).
    const points = isCatch ? '0,0 24,0 18.4,24 5.6,24' : '5.6,0 18.4,0 24,24 0,24'
    const fill = isCatch ? '#ffe0b2' : '#ffccbc'
    const stroke = isCatch ? '#e65100' : '#bf360c'
    const rotate = notation === 'bpmn' ? 'rotate(-90 12 12)' : undefined
    return (
      <svg width="24" height="24" viewBox="0 0 24 24">
        <polygon
          points={points}
          fill={fill}
          stroke={stroke}
          strokeWidth="1.5"
          strokeLinejoin="round"
          transform={rotate}
        />
      </svg>
    )
  }

  // BPMN symbols
  if (notation === 'bpmn') {
    // Start Event - thin circle
    if (type === 'start') {
      return (
        <svg width="24" height="24" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" fill="none" stroke="#22c55e" strokeWidth="2" />
        </svg>
      )
    }
    // End Event - thick circle
    if (type === 'end') {
      return (
        <svg width="24" height="24" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" fill="none" stroke="#ef4444" strokeWidth="4" />
        </svg>
      )
    }
    // Task - rounded rectangle
    if (type === 'actionProxyWait' || type === 'workflowProxy') {
      return (
        <svg width="28" height="20" viewBox="0 0 28 20">
          <rect x="1" y="1" width="26" height="18" rx="3" fill="none" stroke="#64748b" strokeWidth="2" />
        </svg>
      )
    }
    // Yes/No Step - task with split circle icon (50% smaller, top-left)
    if (type === 'yesNoStep') {
      return (
        <svg width="28" height="20" viewBox="0 0 28 20">
          <rect x="1" y="1" width="26" height="18" rx="3" fill="none" stroke="#64748b" strokeWidth="2" />
          {/* Split circle - green left, red right */}
          <path d="M5,3 A2,2 0 0,0 5,7" fill="#22c55e" />
          <path d="M5,3 A2,2 0 0,1 5,7" fill="#ef4444" />
          <circle cx="5" cy="5" r="2" fill="none" stroke="#64748b" strokeWidth="0.5" />
        </svg>
      )
    }
    // User Interaction Step - task with hand icon (BPMN)
    if (type === 'userInteractionStep') {
      return (
        <svg width="28" height="20" viewBox="0 0 28 20">
          <rect x="1" y="1" width="26" height="18" rx="3" fill="none" stroke="#64748b" strokeWidth="2" />
          <path
            d="M5 14 L5 8 M5 8 C5 6 7 6 7 8 L7 7 C7 5 9 5 9 7 L9 6.5 C9 4.5 11 4.5 11 6.5 L11 7 C11 5 13 5 13 7 L13 11 L12 14 Z"
            fill="none"
            stroke="#64748b"
            strokeWidth="0.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    }
    // Script Step - task with <> code brackets icon
    if (type === 'scriptStep') {
      return (
        <svg width="28" height="20" viewBox="0 0 28 20">
          <rect x="1" y="1" width="26" height="18" rx="3" fill="none" stroke="#64748b" strokeWidth="2" />
          <text x="5" y="13" fontSize="9" fontFamily="monospace" fontWeight="bold" fill="#d97706">
            &lt;&gt;
          </text>
        </svg>
      )
    }
    // Exclusive Gateway (Select 1, Wait Any) - diamond with X
    if (type === 'select1' || type === 'waitAny') {
      return (
        <svg width="24" height="24" viewBox="0 0 24 24">
          <path d="M12 2 L22 12 L12 22 L2 12 Z" fill="none" stroke="#f59e0b" strokeWidth="2" />
          <path d="M8 8 L16 16 M16 8 L8 16" stroke="#f59e0b" strokeWidth="2" />
        </svg>
      )
    }
    // Parallel Gateway - diamond with +
    if (type === 'parallel' || type === 'waitAll') {
      return (
        <svg width="24" height="24" viewBox="0 0 24 24">
          <path d="M12 2 L22 12 L12 22 L2 12 Z" fill="none" stroke="#a855f7" strokeWidth="2" />
          <path d="M12 6 L12 18 M6 12 L18 12" stroke="#a855f7" strokeWidth="2" />
        </svg>
      )
    }
    // Gate — diamond with two vertical parallel lines
    if (type === 'gateStep') {
      return (
        <svg width="24" height="24" viewBox="0 0 24 24">
          <polygon points="12,1 23,12 12,23 1,12" fill="none" stroke="#f59e0b" strokeWidth="2" />
          <line x1="10" y1="8" x2="10" y2="16" stroke="#f59e0b" strokeWidth="1.5" />
          <line x1="14" y1="8" x2="14" y2="16" stroke="#f59e0b" strokeWidth="1.5" />
        </svg>
      )
    }
  }

  // ISA 88 PFC symbols
  if (notation === 'isa88') {
    // Initial/Terminal step - circle
    if (type === 'start' || type === 'end') {
      const color = type === 'start' ? '#22c55e' : '#ef4444'
      return (
        <svg width="24" height="24" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" fill="none" stroke={color} strokeWidth="2" />
        </svg>
      )
    }
    // Step - rectangle with corner lines
    if (type === 'actionProxyWait' || type === 'workflowProxy') {
      return (
        <svg width="28" height="20" viewBox="0 0 28 20">
          <rect x="1" y="1" width="26" height="18" fill="none" stroke="#64748b" strokeWidth="2" />
          {/* Corner lines indicating hierarchy */}
          <line x1="1" y1="5" x2="5" y2="1" stroke="#64748b" strokeWidth="1" />
          <line x1="1" y1="8" x2="8" y2="1" stroke="#64748b" strokeWidth="1" />
        </svg>
      )
    }
    // Yes/No Step - rectangle with corner lines and split circle icon (50% smaller, top-left)
    if (type === 'yesNoStep') {
      return (
        <svg width="28" height="20" viewBox="0 0 28 20">
          <rect x="1" y="1" width="26" height="18" fill="none" stroke="#64748b" strokeWidth="2" />
          <line x1="1" y1="5" x2="5" y2="1" stroke="#64748b" strokeWidth="1" />
          <line x1="1" y1="8" x2="8" y2="1" stroke="#64748b" strokeWidth="1" />
          {/* Split circle - green left, red right */}
          <path d="M11,3 A2,2 0 0,0 11,7" fill="#22c55e" />
          <path d="M11,3 A2,2 0 0,1 11,7" fill="#ef4444" />
          <circle cx="11" cy="5" r="2" fill="none" stroke="#64748b" strokeWidth="0.5" />
        </svg>
      )
    }
    // User Interaction Step - rectangle with corner lines and hand icon (ISA88)
    if (type === 'userInteractionStep') {
      return (
        <svg width="28" height="20" viewBox="0 0 28 20">
          <rect x="1" y="1" width="26" height="18" fill="none" stroke="#64748b" strokeWidth="2" />
          <line x1="1" y1="5" x2="5" y2="1" stroke="#64748b" strokeWidth="1" />
          <line x1="1" y1="8" x2="8" y2="1" stroke="#64748b" strokeWidth="1" />
          <path
            d="M12 14 L12 8 M12 8 C12 6 14 6 14 8 L14 7 C14 5 16 5 16 7 L16 6.5 C16 4.5 18 4.5 18 6.5 L18 7 C18 5 20 5 20 7 L20 11 L19 14 Z"
            fill="none"
            stroke="#64748b"
            strokeWidth="0.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    }
    // Script Step - rectangle with corner lines and <> code icon
    if (type === 'scriptStep') {
      return (
        <svg width="28" height="20" viewBox="0 0 28 20">
          <rect x="1" y="1" width="26" height="18" fill="none" stroke="#64748b" strokeWidth="2" />
          <line x1="1" y1="5" x2="5" y2="1" stroke="#64748b" strokeWidth="1" />
          <line x1="1" y1="8" x2="8" y2="1" stroke="#64748b" strokeWidth="1" />
          <text x="14" y="13" fontSize="9" fontFamily="monospace" fontWeight="bold" fill="#d97706">
            &lt;&gt;
          </text>
        </svg>
      )
    }
    // Selection - single horizontal bar
    if (type === 'select1' || type === 'waitAny') {
      return (
        <svg width="28" height="12" viewBox="0 0 28 12">
          <line x1="2" y1="6" x2="26" y2="6" stroke="#f59e0b" strokeWidth="3" />
        </svg>
      )
    }
    // Parallel - double horizontal bar
    if (type === 'parallel' || type === 'waitAll') {
      return (
        <svg width="28" height="16" viewBox="0 0 28 16">
          <line x1="2" y1="5" x2="26" y2="5" stroke="#a855f7" strokeWidth="2" />
          <line x1="2" y1="11" x2="26" y2="11" stroke="#a855f7" strokeWidth="2" />
        </svg>
      )
    }
    // Gate (Transition Step) — narrow double bar with thin centre-line stems (SFC transition mark)
    if (type === 'gateStep') {
      return (
        <svg width="24" height="24" viewBox="0 0 24 24">
          <line x1="4" y1="10" x2="20" y2="10" stroke="#f59e0b" strokeWidth="2" />
          <line x1="4" y1="14" x2="20" y2="14" stroke="#f59e0b" strokeWidth="2" />
          <line x1="12" y1="0" x2="12" y2="10" stroke="#f59e0b" strokeWidth="1" />
          <line x1="12" y1="14" x2="12" y2="24" stroke="#f59e0b" strokeWidth="1" />
        </svg>
      )
    }
  }

  // Flowchart symbols (default)
  // Start/End - circles
  if (type === 'start') {
    return (
      <svg width="24" height="24" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" fill="#22c55e" />
      </svg>
    )
  }
  if (type === 'end') {
    return (
      <svg width="24" height="24" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" fill="#ef4444" />
      </svg>
    )
  }
  // Actions - rectangles
  if (type === 'actionProxyWait' || type === 'workflowProxy') {
    return (
      <svg width="28" height="18" viewBox="0 0 28 18">
        <rect x="1" y="1" width="26" height="16" fill="#64748b" rx="2" />
      </svg>
    )
  }
  // Yes/No Step - rectangle with split circle icon (50% smaller, top-left)
  if (type === 'yesNoStep') {
    return (
      <svg width="28" height="18" viewBox="0 0 28 18">
        <rect x="1" y="1" width="26" height="16" fill="#64748b" rx="2" />
        {/* Split circle - green left, red right */}
        <path d="M5,3 A2,2 0 0,0 5,7" fill="#22c55e" />
        <path d="M5,3 A2,2 0 0,1 5,7" fill="#ef4444" />
        <circle cx="5" cy="5" r="2" fill="none" stroke="white" strokeWidth="0.5" />
      </svg>
    )
  }
  // User Interaction Step - filled rectangle with hand icon (Flowchart)
  if (type === 'userInteractionStep') {
    return (
      <svg width="28" height="18" viewBox="0 0 28 18">
        <rect x="1" y="1" width="26" height="16" fill="#64748b" rx="2" />
        <path
          d="M5 12 L5 6 M5 6 C5 4 7 4 7 6 L7 5 C7 3 9 3 9 5 L9 4.5 C9 2.5 11 2.5 11 4.5 L11 5 C11 3 13 3 13 5 L13 9 L12 12 Z"
          fill="none"
          stroke="white"
          strokeWidth="0.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  // Script Step - filled rectangle with <> code brackets icon
  if (type === 'scriptStep') {
    return (
      <svg width="28" height="18" viewBox="0 0 28 18">
        <rect x="1" y="1" width="26" height="16" fill="#64748b" rx="2" />
        <text x="4" y="12" fontSize="9" fontFamily="monospace" fontWeight="bold" fill="white">
          &lt;&gt;
        </text>
      </svg>
    )
  }
  // Decisions - diamonds
  if (type === 'select1' || type === 'waitAny') {
    return (
      <svg width="24" height="24" viewBox="0 0 24 24">
        <path d="M12 2 L22 12 L12 22 L2 12 Z" fill="#f59e0b" />
      </svg>
    )
  }
  // Parallel - diamond inside diamond (nested)
  if (type === 'parallel' || type === 'waitAll') {
    return (
      <svg width="24" height="24" viewBox="0 0 24 24">
        {/* Outer diamond */}
        <path d="M12 1 L23 12 L12 23 L1 12 Z" fill="none" stroke="#a855f7" strokeWidth="2" />
        {/* Inner diamond */}
        <path d="M12 6 L18 12 L12 18 L6 12 Z" fill="none" stroke="#a855f7" strokeWidth="2" />
      </svg>
    )
  }
  // Gate — diamond with two horizontal parallel lines
  if (type === 'gateStep') {
    return (
      <svg width="24" height="24" viewBox="0 0 24 24">
        <polygon points="12,1 23,12 12,23 1,12" fill="none" stroke="#f59e0b" strokeWidth="2" />
        <line x1="8" y1="10" x2="16" y2="10" stroke="#f59e0b" strokeWidth="1.5" />
        <line x1="8" y1="14" x2="16" y2="14" stroke="#f59e0b" strokeWidth="1.5" />
      </svg>
    )
  }

  // Fallback
  return <div className="w-6 h-6 bg-slate-300 rounded" />
}

/** Default label for a node type (matches FlowCanvas.getDefaultLabel). */
function getDefaultLabel(type: NodeType): string {
  switch (type) {
    case 'start':
      return 'START'
    case 'end':
      return 'END'
    case 'actionProxyWait':
      return 'Env Action'
    case 'yesNoStep':
      return 'Yes/No'
    case 'userInteractionStep':
      return 'User Interaction'
    case 'scriptStep':
      return 'Script'
    case 'workflowProxy':
      return 'Child Workflow'
    case 'select1':
      return 'SELECT 1'
    case 'waitAny':
      return 'WAIT ANY'
    case 'parallel':
      return 'PARALLEL'
    case 'waitAll':
      return 'WAIT ALL'
    case 'catch':
      return 'CATCH'
    case 'return':
      return 'RETURN'
    case 'gateStep':
      return 'Gate'
  }
}

/**
 * Draggable step type palette for the workflow editor.
 * Shows notation-appropriate symbols (BPMN, ISA 88, or Flowchart).
 * Environment actions are rendered dynamically from linked environments.
 *
 * Items can be added to the canvas via drag-and-drop OR click (inserts at canvas center).
 */
export const StepPalette = memo(function StepPalette() {
  const notation = useNotationStore((s) => s.notation)
  const [collapsed, setCollapsed] = useState(false)
  const addNode = useFlowStore((s) => s.addNode)
  const { screenToFlowPosition } = useReactFlow()
  const canEdit = useCanEditActiveSpec()

  /** Find a non-overlapping position near the viewport center. */
  const findOpenPosition = useCallback(() => {
    // Get the center of the visible canvas in screen coords, then convert to flow coords
    const canvasEl = document.querySelector('.react-flow') as HTMLElement | null
    const w = canvasEl?.clientWidth ?? 800
    const h = canvasEl?.clientHeight ?? 600
    const center = screenToFlowPosition({ x: w / 2, y: h / 2 })

    // Snap center to 5px grid
    const x = Math.round(center.x / 5) * 5
    let y = Math.round(center.y / 5) * 5

    // Cascade: if a node is already near this spot, nudge down
    const existing = useFlowStore.getState().nodes
    const THRESHOLD = 20
    let attempts = 0
    while (
      attempts < 30 &&
      existing.some((n) => Math.abs(n.position.x - x) < THRESHOLD && Math.abs(n.position.y - y) < THRESHOLD)
    ) {
      y += 60
      attempts++
    }
    return { x, y }
  }, [screenToFlowPosition])

  const onDragStart = (event: React.DragEvent, nodeType: NodeType) => {
    event.dataTransfer.setData('application/reactflow', nodeType)
    event.dataTransfer.effectAllowed = 'move'
  }

  /** Click-to-add: inserts a new node at the viewport center. */
  const handleClickAdd = (type: NodeType, label?: string) => {
    if (!canEdit) return
    const newNode = {
      id: generateOID(WORKER_STEP),
      type,
      position: findOpenPosition(),
      data: defaultStepData(type, label || getDefaultLabel(type)),
    }
    addNode(newNode)
  }

  if (collapsed) {
    return (
      <div
        className="shrink-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 flex flex-col overflow-y-auto"
        style={{ width: 40 }}
      >
        {/* Expand toggle */}
        <button
          onClick={() => setCollapsed(false)}
          className="flex items-center justify-center py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors border-b border-slate-200 dark:border-slate-700"
          title="Expand Step Palette"
        >
          <ChevronRight className="h-4 w-4 text-slate-500 dark:text-slate-400" />
        </button>

        {/* Step types - icon only */}
        {allStepTypes.map(({ type, label }) => (
          <div
            key={type}
            role="button"
            aria-label={`Add ${label} step`}
            draggable={canEdit}
            onDragStart={canEdit ? (event) => onDragStart(event, type) : undefined}
            onClick={() => handleClickAdd(type)}
            aria-disabled={!canEdit}
            className={`flex items-center justify-center py-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ${canEdit ? 'cursor-grab active:cursor-grabbing' : 'cursor-not-allowed opacity-50'}`}
            title={label}
          >
            <NotationSymbol type={type} notation={notation} />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="w-fit shrink-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 p-2 overflow-y-auto">
      <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1 px-1 flex items-center">
        <span className="flex-1">
          Step Types
          <span className="text-xs font-normal text-slate-500 dark:text-slate-400 ml-2">
            ({notation === 'bpmn' ? 'BPMN' : notation === 'isa88' ? 'ISA 88' : 'Flowchart'})
          </span>
        </span>
        <button
          onClick={() => setCollapsed(true)}
          className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title="Collapse Step Palette"
        >
          <ChevronLeft className="h-4 w-4 text-slate-400 dark:text-slate-500" />
        </button>
      </h2>
      <div>
        {/* Step types */}
        {allStepTypes.map(({ type, label }) => (
          <div
            key={type}
            role="button"
            aria-label={`Add ${label} step`}
            draggable={canEdit}
            onDragStart={canEdit ? (event) => onDragStart(event, type) : undefined}
            onClick={() => handleClickAdd(type)}
            aria-disabled={!canEdit}
            className={`flex items-center gap-2 py-1.5 px-2 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ${canEdit ? 'cursor-grab active:cursor-grabbing' : 'cursor-not-allowed opacity-50'}`}
            title={
              type === 'userInteractionStep'
                ? 'Display a custom form to the user with text, inputs, images, and buttons'
                : type === 'yesNoStep'
                  ? 'Present a Yes/No decision with customizable button labels'
                  : type === 'gateStep'
                    ? notation === 'isa88'
                      ? 'Transition Step — holds the flow until its script returns TRUE'
                      : 'Gate — holds the flow until its script returns TRUE (evaluated on a cycle)'
                    : undefined
            }
          >
            <GripVertical className="size-3 text-slate-300 dark:text-slate-600 shrink-0" />
            <div className="w-7 h-6 flex items-center justify-center">
              <NotationSymbol type={type} notation={notation} />
            </div>
            <span className="text-sm text-slate-700 dark:text-slate-200">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
})
