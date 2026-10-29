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

import { useEffect } from 'react'
import { useFlowStore } from '@/stores/flowStore'

/**
 * Hook for undo/redo functionality with keyboard shortcuts.
 *
 * Provides:
 * - undo/redo functions from Zundo temporal middleware
 * - canUndo/canRedo boolean flags
 * - historyLength/futureLength counts
 * - Automatic keyboard shortcut registration:
 *   - Ctrl+Z / Cmd+Z: Undo
 *   - Ctrl+Shift+Z / Cmd+Shift+Z: Redo (Mac convention)
 *   - Ctrl+Y / Cmd+Y: Redo (Windows convention)
 *
 * Usage:
 * ```typescript
 * function MyComponent() {
 *   const { undo, redo, canUndo, canRedo } = useUndoRedo();
 *
 *   return (
 *     <div>
 *       <button onClick={undo} disabled={!canUndo}>Undo</button>
 *       <button onClick={redo} disabled={!canRedo}>Redo</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useUndoRedo() {
  // Access temporal state from Zundo middleware
  // Note: We get state directly since temporal state doesn't need React reactivity
  const temporalState = useFlowStore.temporal.getState()
  const { undo, redo, pastStates, futureStates } = temporalState

  const canUndo = pastStates.length > 0
  const canRedo = futureStates.length > 0

  // Register keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Skip if user is typing in an input field
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable)
      ) {
        return
      }

      const isMod = event.metaKey || event.ctrlKey

      // Ctrl+Z or Cmd+Z for undo/redo
      if (isMod && event.key === 'z') {
        event.preventDefault()

        if (event.shiftKey) {
          // Ctrl+Shift+Z / Cmd+Shift+Z: Redo (Mac convention)
          const { futureStates: future, redo: doRedo } = useFlowStore.temporal.getState()
          if (future.length > 0) {
            doRedo()
          }
        } else {
          // Ctrl+Z / Cmd+Z: Undo
          const { pastStates: past, undo: doUndo } = useFlowStore.temporal.getState()
          if (past.length > 0) {
            doUndo()
          }
        }
      }

      // Ctrl+Y or Cmd+Y: Redo (Windows convention)
      if (isMod && event.key === 'y') {
        event.preventDefault()

        const { futureStates: future, redo: doRedo } = useFlowStore.temporal.getState()
        if (future.length > 0) {
          doRedo()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, []) // Empty deps - we access fresh state inside handler

  return {
    /** Undo the last state change */
    undo,

    /** Redo the last undone state change */
    redo,

    /** Whether there are states to undo */
    canUndo,

    /** Whether there are states to redo */
    canRedo,

    /** Number of past states available for undo */
    historyLength: pastStates.length,

    /** Number of future states available for redo */
    futureLength: futureStates.length,
  }
}
