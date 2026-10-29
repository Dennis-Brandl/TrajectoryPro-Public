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

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Notation, LayoutDirection } from '@/types/notation'
import { useLibraryStore } from './libraryStore'
import { useSpecificationStore } from './specificationStore'

const VALID_NOTATIONS: readonly Notation[] = ['flowchart', 'bpmn', 'isa88']
const DEFAULT_NOTATION: Notation = 'flowchart'

interface NotationState {
  notation: Notation
  setNotation: (notation: Notation) => void
}

/**
 * Zustand store for notation preference with localStorage persistence.
 *
 * Tracks which diagram notation style is active (flowchart, bpmn, isa88).
 * Preference persists across browser sessions.
 *
 * Usage:
 * ```typescript
 * const notation = useNotationStore((state) => state.notation);
 * const { setNotation } = useNotationStore.getState();
 * ```
 */
export const useNotationStore = create<NotationState>()(
  persist(
    (set) => ({
      notation: 'flowchart',
      setNotation: (notation) => set({ notation }),
    }),
    { name: 'notation-preference' },
  ),
)

/**
 * Returns layout direction for a given notation.
 * BPMN uses left-to-right, others use top-to-bottom.
 */
export function getLayoutDirection(notation: Notation): LayoutDirection {
  return notation === 'bpmn' ? 'LR' : 'TB'
}

/**
 * Resolves the notation a spec should display from its persisted `data.notation`.
 *
 * Falls back to `flowchart` when the spec has no notation saved. This default is
 * intentional — without it the global `notationStore` value bleeds into specs
 * that were never explicitly assigned a notation, so changing notation in one
 * workflow appeared to change it in unrelated workflows on subsequent loads.
 */
export function resolveSpecNotation(data: Record<string, unknown> | undefined): Notation {
  const candidate = data?.notation
  if (typeof candidate === 'string' && (VALID_NOTATIONS as readonly string[]).includes(candidate)) {
    return candidate as Notation
  }
  return DEFAULT_NOTATION
}

/**
 * Writes the current notation choice into the active spec's `data.notation`.
 * No-op when no spec is selected or the selected id is not in the spec store.
 *
 * `NotationSwitcher` calls this after `setNotation` so the choice survives
 * navigating away and back; without it the change lives only in the global
 * preference store and is overwritten the next time any spec loads.
 */
export function persistNotationToActiveSpec(notation: Notation): void {
  const specId = useLibraryStore.getState().selectedSpecificationId
  if (!specId) return
  const specStore = useSpecificationStore.getState()
  const existing = specStore.specs.get(specId)
  if (!existing) return
  specStore.updateInMemory(specId, { data: { ...existing.data, notation } })
}
