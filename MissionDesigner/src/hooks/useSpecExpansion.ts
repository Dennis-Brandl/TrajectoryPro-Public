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

const STORAGE_KEY = 'mission-spec-expansion'
const DEBOUNCE_MS = 300

interface ExpansionState {
  ids: Set<string>
  isExpanded: (specId: string) => boolean
  toggle: (specId: string) => void
  setExpanded: (specId: string, value: boolean) => void
}

function loadInitial(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((x): x is string => typeof x === 'string'))
  } catch {
    return new Set()
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null
function schedulePersist(ids: Set<string>) {
  if (typeof window === 'undefined') return
  if (persistTimer !== null) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(ids)))
    } catch {
      // storage full or disabled — no-op
    }
  }, DEBOUNCE_MS)
}

const store = create<ExpansionState>((set, get) => ({
  ids: loadInitial(),
  isExpanded: (specId) => get().ids.has(specId),
  toggle: (specId) =>
    set((s) => {
      const next = new Set(s.ids)
      if (next.has(specId)) next.delete(specId)
      else next.add(specId)
      schedulePersist(next)
      return { ids: next }
    }),
  setExpanded: (specId, value) =>
    set((s) => {
      if (s.ids.has(specId) === value) return s
      const next = new Set(s.ids)
      if (value) next.add(specId)
      else next.delete(specId)
      schedulePersist(next)
      return { ids: next }
    }),
}))

export function useSpecExpansion(): ExpansionState
export function useSpecExpansion<T>(selector: (s: ExpansionState) => T): T
export function useSpecExpansion<T>(selector?: (s: ExpansionState) => T): ExpansionState | T {
  return selector ? store(selector) : store()
}
