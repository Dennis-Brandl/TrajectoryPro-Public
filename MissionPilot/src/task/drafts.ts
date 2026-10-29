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

import type { FormValues } from '@mission/form-schema'

// Spec 2026-10-09 §5.7 (audit 1 M5): a form's typed values survive a reload, a tab
// switch and a work-center switch. Kept per assignment in sessionStorage (this browser
// tab only), and only the values the operator changed from the form's own defaults, so
// an untouched form leaves nothing behind and the count really is "values you entered".
export const DRAFT_PREFIX = 'pilot:draft:'

interface StoredDraft {
  stepInstanceId: string
  values: FormValues
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** The values that differ from the seeded defaults. Clearing a default counts as typing. */
export function typedValues(values: FormValues, seed: FormValues): FormValues {
  const out: FormValues = {}
  for (const key of new Set([...Object.keys(values), ...Object.keys(seed)])) {
    if (!same(values[key], seed[key])) out[key] = values[key] ?? ''
  }
  return out
}

function read(assignmentId: string): StoredDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_PREFIX + assignmentId)
    if (!raw) return null
    const d = JSON.parse(raw) as Partial<StoredDraft>
    return typeof d.stepInstanceId === 'string' && d.values !== null && typeof d.values === 'object'
      ? (d as StoredDraft)
      : null
  } catch {
    return null // corrupt entry: treat as no draft
  }
}

/** The saved typed values for this step instance; null when none, or saved for another instance. */
export function readDraft(assignmentId: string, stepInstanceId: string): FormValues | null {
  const d = read(assignmentId)
  return d && d.stepInstanceId === stepInstanceId ? d.values : null
}

export function writeDraft(assignmentId: string, stepInstanceId: string, typed: FormValues): void {
  try {
    if (Object.keys(typed).length === 0) sessionStorage.removeItem(DRAFT_PREFIX + assignmentId)
    else sessionStorage.setItem(DRAFT_PREFIX + assignmentId, JSON.stringify({ stepInstanceId, values: typed }))
  } catch {
    // Storage full or disabled: the form still works, it just won't survive a reload.
  }
}

/** How many values the operator entered in the saved draft. */
export function draftCount(assignmentId: string): number {
  return Object.keys(read(assignmentId)?.values ?? {}).length
}

export function clearDraft(assignmentId: string): void {
  try {
    sessionStorage.removeItem(DRAFT_PREFIX + assignmentId)
  } catch {
    // nothing to clear
  }
}

/** Sign-out and session end: a shared terminal must not hand typed values to the next operator. */
export function clearAllDrafts(): void {
  try {
    const keys: string[] = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i)
      if (key && key.startsWith(DRAFT_PREFIX)) keys.push(key)
    }
    for (const key of keys) sessionStorage.removeItem(key)
  } catch {
    // nothing to clear
  }
}
