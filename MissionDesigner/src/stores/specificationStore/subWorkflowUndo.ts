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

// Module-level buffer of deleted sub-workflow subtree snapshots. Edits auto-save
// after a 1500ms debounce (saveScheduler), so by the time the user presses undo a
// deleted sub-workflow may already be committed (and purged) server-side. This
// buffer preserves the full subtree (the embedded child spec + its descendants)
// so restoreSubWorkflowSubtree can re-create it. Keyed by the embedded child spec
// id (the direct child of the open spec). Cleared when the document changes
// (alongside the temporal undo-history clear).

import type { Specification } from './types'

const buffer = new Map<string, Specification[]>()

/** Store the snapshot of a deleted sub-workflow subtree (root child + descendants). */
export function bufferDeletedSubtree(rootId: string, snapshot: Specification[]): void {
  buffer.set(rootId, snapshot)
}

/** The buffered subtree snapshot for an embedded child spec id, if any. */
export function getDeletedSubtree(rootId: string): Specification[] | undefined {
  return buffer.get(rootId)
}

/** Drop all buffered subtrees — called when the open document changes. */
export function clearSubWorkflowUndoBuffer(): void {
  buffer.clear()
}
