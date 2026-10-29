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

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useUpdateNodeInternals } from '@xyflow/react'
import { useNotationStore, getLayoutDirection, persistNotationToActiveSpec } from '@/stores/notationStore'
import { useAutoLayout } from '@/hooks/useAutoLayout'
import { useFlowStore } from '@/stores/flowStore'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@mission/ui'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@mission/ui'
import { Button } from '@mission/ui'
import type { Notation } from '@/types/notation'

/**
 * Notation display names for UI.
 */
const notationLabels: Record<Notation, string> = {
  flowchart: 'Flowchart Style',
  bpmn: 'BPMN Style',
  isa88: 'ISA 88 Style',
}

/**
 * Notation descriptions for confirmation dialog.
 */
const notationDescriptions: Record<Notation, string> = {
  flowchart: 'Top-to-bottom flow with diamond decision nodes and double-diamond parallel nodes.',
  bpmn: 'Left-to-right flow with BPMN 2.0 symbols: circles for events, rounded rectangles for tasks, diamonds with X/+ markers for gateways.',
  isa88:
    'Top-to-bottom flow with ISA 88 Procedural Function Chart symbols: rectangles with corner lines, horizontal bars for branching.',
}

/**
 * NotationSwitcher component.
 * Dropdown to select diagram notation with confirmation dialog.
 * Per CONTEXT.md: dropdown in toolbar, confirmation shows preview, auto-layout on switch.
 */
export function NotationSwitcher() {
  const notation = useNotationStore((s) => s.notation)
  const setNotation = useNotationStore((s) => s.setNotation)
  const nodes = useFlowStore((s) => s.nodes)
  const { applyLayout } = useAutoLayout()
  const updateNodeInternals = useUpdateNodeInternals()

  const [pendingNotation, setPendingNotation] = useState<Notation | null>(null)
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)

  /**
   * Handle notation selection from dropdown.
   * If nodes exist on canvas, show confirmation. Otherwise, switch immediately.
   */
  const handleSelect = (newNotation: Notation) => {
    if (newNotation === notation) return

    if (nodes.length > 0) {
      // Has nodes - show confirmation
      setPendingNotation(newNotation)
      setIsConfirmOpen(true)
    } else {
      // Empty canvas - switch immediately
      setNotation(newNotation)
      persistNotationToActiveSpec(newNotation)
    }
  }

  /**
   * Confirm notation switch.
   * Updates notation and applies auto-layout for the new direction.
   * Preserves edges by storing and restoring them across the notation change.
   */
  const handleConfirm = () => {
    if (!pendingNotation) return

    // Store current edges before notation switch
    const currentEdges = useFlowStore.getState().edges
    const setEdges = useFlowStore.getState().setEdges

    setNotation(pendingNotation)
    persistNotationToActiveSpec(pendingNotation)

    // Apply layout with new notation's direction
    // Small delay to let nodeTypes update first, then restore edges
    setTimeout(() => {
      // Restore edges that might have been lost during handle position changes
      const afterSwitchEdges = useFlowStore.getState().edges
      if (afterSwitchEdges.length < currentEdges.length) {
        setEdges(currentEdges)
      }

      const direction = getLayoutDirection(pendingNotation)
      applyLayout(direction)

      // Force React Flow to recalculate handle positions after notation change
      // (handles move from LR to TB or vice versa, but RF caches old positions)
      requestAnimationFrame(() => {
        const nodeIds = useFlowStore.getState().nodes.map((n) => n.id)
        if (nodeIds.length > 0) {
          updateNodeInternals(nodeIds)
        }
      })
    }, 100)

    setPendingNotation(null)
    setIsConfirmOpen(false)
  }

  /**
   * Cancel notation switch.
   */
  const handleCancel = () => {
    setPendingNotation(null)
    setIsConfirmOpen(false)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="gap-2">
            {notationLabels[notation]}
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {(Object.keys(notationLabels) as Notation[]).map((n) => (
            <DropdownMenuItem key={n} onClick={() => handleSelect(n)} className={n === notation ? 'bg-slate-100' : ''}>
              <span className="font-medium">{notationLabels[n]}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Switch to {pendingNotation ? notationLabels[pendingNotation] : ''} Notation?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>This will change the visual style of your diagram and re-layout all nodes.</p>
              {pendingNotation && (
                <div className="p-3 bg-slate-50 rounded-md text-sm">
                  <strong>{notationLabels[pendingNotation]}:</strong> {notationDescriptions[pendingNotation]}
                </div>
              )}
              <p className="text-amber-600">
                {pendingNotation === 'bpmn'
                  ? 'Nodes will be arranged left-to-right.'
                  : 'Nodes will be arranged top-to-bottom.'}
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancel}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>Switch Notation</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
