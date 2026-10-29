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

import { useFlowStore } from '@/stores/flowStore'
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

/**
 * Dialog that appears when a draft is detected in IndexedDB on app load.
 * Allows user to recover their unsaved work or start fresh.
 */
export function DraftRecoveryDialog() {
  const hasDraft = useFlowStore((s) => s.hasDraft)
  const draftAt = useFlowStore((s) => s.draftAt)
  const clearDraft = useFlowStore((s) => s.clearDraft)
  const setNodes = useFlowStore((s) => s.setNodes)
  const setEdges = useFlowStore((s) => s.setEdges)
  const setWorkflowInputs = useFlowStore((s) => s.setWorkflowInputs)
  const setWorkflowOutputs = useFlowStore((s) => s.setWorkflowOutputs)
  const setWorkflowValues = useFlowStore((s) => s.setWorkflowValues)
  const setWorkflowResources = useFlowStore((s) => s.setWorkflowResources)

  const handleKeep = () => {
    // Draft is already in state from rehydration, just clear the flag
    clearDraft()
    // Clear undo history to start fresh with recovered state
    useFlowStore.temporal.getState().clear()
  }

  const handleDiscard = () => {
    // Clear diagram state AND workflow-level properties
    setNodes([])
    setEdges([])
    setWorkflowInputs([])
    setWorkflowOutputs([])
    setWorkflowValues([])
    setWorkflowResources([])
    clearDraft()
    // Clear undo history
    useFlowStore.temporal.getState().clear()
  }

  // Format timestamp for display
  const formattedTime = draftAt ? new Date(draftAt).toLocaleString() : 'Unknown time'

  return (
    <AlertDialog open={hasDraft}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Recover unsaved work?</AlertDialogTitle>
          <AlertDialogDescription>
            There is unsaved work from {formattedTime}. Do you want to continue where you left off?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleDiscard}>Clear &amp; Start Fresh</AlertDialogCancel>
          <AlertDialogAction onClick={handleKeep}>Recover Unsaved Work</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
