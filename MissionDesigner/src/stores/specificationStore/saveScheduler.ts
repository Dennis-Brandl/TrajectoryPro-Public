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

// Phase 35 §3.8: debounced flush scheduler.
// Mutation actions call scheduleFlush(); after DEBOUNCE_MS of quiet, batchSave fires.
//
// Why 1500 ms: while a batchSave is in flight, updateSpecData/updateInMemory
// silently no-op (§3.13 i5 edit-lock). At a 500 ms debounce, typing through
// natural pauses (e.g. between fields, looking at the screen) triggers a save,
// and the next keystroke arriving during the ~50-200 ms save round-trip is
// dropped — which the user experiences as "save happens on each keystroke and
// loses characters." 1500 ms is long enough that mid-thought pauses don't
// repeatedly trigger saves but short enough that the crash-buffer's per-keystroke
// snapshot still bounds data loss tightly.

import { useSpecificationStore, isBatchSaveInFlight } from '../specificationStore'
import type { SaveError } from './types'

const DEBOUNCE_MS = 1500
let timeoutId: ReturnType<typeof setTimeout> | null = null

export function scheduleFlush(): void {
  if (timeoutId !== null) clearTimeout(timeoutId)
  timeoutId = setTimeout(() => {
    timeoutId = null
    void useSpecificationStore.getState().batchSave()
  }, DEBOUNCE_MS)
}

export function cancelFlush(): void {
  if (timeoutId !== null) {
    clearTimeout(timeoutId)
    timeoutId = null
  }
}

export function hasPendingFlush(): boolean {
  return timeoutId !== null
}

/** flushNow's rejection: a save failed, or the specs kept changing. */
export class SaveFailedError extends Error {
  constructor(readonly saveError: SaveError) {
    super(saveError.message)
    this.name = 'SaveFailedError'
  }
}

const MAX_FLUSH_PASSES = 5

/**
 * Save everything now. Resolves only when nothing is dirty, saving or pending;
 * rejects with SaveFailedError when a save failed, or when the specs were
 * still changing after MAX_FLUSH_PASSES saves.
 */
export async function flushNow(): Promise<void> {
  // A failure left over from before this flush (e.g. later discarded) is not
  // this flush's failure: every attempt clears lastSaveError and sets a new one.
  const staleError = useSpecificationStore.getState().lastSaveError
  for (let pass = 0; pass < MAX_FLUSH_PASSES; pass++) {
    cancelFlush()
    await useSpecificationStore.getState().batchSave()
    const state = useSpecificationStore.getState()
    if (state.lastSaveError && state.lastSaveError !== staleError) {
      throw new SaveFailedError(state.lastSaveError)
    }
    if (state.dirtyIds.size === 0 && state.savingIds.size === 0 && !isBatchSaveInFlight() && !hasPendingFlush()) {
      return
    }
  }
  // Give up out loud: the global toast and the red save button read lastSaveError,
  // so Close / the unsaved dialog's Save never fail silently.
  const stillChanging: SaveError = { status: 0, code: 'still_changing', message: 'Changes are still being made' }
  useSpecificationStore.setState((s) => {
    s.lastSaveError = stillChanging
  })
  throw new SaveFailedError(stillChanging)
}

/** beforeunload guard — install once at app boot. */
export function installNavigationGuard(): () => void {
  const handler = (event: BeforeUnloadEvent) => {
    const state = useSpecificationStore.getState()
    const hasUnsaved =
      state.dirtyIds.size > 0 ||
      state.savingIds.size > 0 ||
      state.librariesDirty.size > 0 ||
      state.librariesSaving.size > 0
    if (hasUnsaved) {
      event.preventDefault()
      // Deprecated but still required by some browsers
      event.returnValue = ''
    }
  }
  window.addEventListener('beforeunload', handler)
  return () => window.removeEventListener('beforeunload', handler)
}
