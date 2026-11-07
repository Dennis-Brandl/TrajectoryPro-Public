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
import { toast } from 'sonner'
import { useFlowStore } from '@/stores/flowStore'

/**
 * Unsaved work found in IndexedDB on app load is always kept. There used to be a
 * "Recover unsaved work?" dialog whose "Clear & Start Fresh" button wiped the open
 * workflow; it was too easy to hit when leaving a page, so the choice is gone. The
 * draft is already in the store from rehydration: clear the flag and the undo
 * history (so undo can't step back past the restore) and say what happened.
 */
export function DraftRestoredNotice() {
  const hasDraft = useFlowStore((s) => s.hasDraft)
  const draftAt = useFlowStore((s) => s.draftAt)

  useEffect(() => {
    if (!hasDraft) return
    useFlowStore.getState().clearDraft()
    useFlowStore.temporal.getState().clear()
    const when = draftAt ? ` from ${new Date(draftAt).toLocaleString()}` : ''
    toast.info(`Restored your unsaved work${when}.`, { id: 'draft-restored' })
  }, [hasDraft, draftAt])

  return null
}
