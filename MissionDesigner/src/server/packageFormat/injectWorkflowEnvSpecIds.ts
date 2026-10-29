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

// Resolve `_pendingEnvironmentSpecs[]` (carried per workflow spec by the v7
// envelope parser via importWorkflowSpecToInternal) to the concrete env spec
// ids created or reused by importLibrariesFromZip, then mirror them into the
// workflow's `data.environmentSpecIds`. The editor's SpecificationHeader reads
// that field to render attached environment chips; without this remap, the
// imported workflow looks unattached even though `specification_environment`
// links the workflow to the env library at the row level.
//
// The function mutates `plan.specs[].dataJson` in place and strips the
// pending sidecar so the persisted spec data is the simple post-resolve shape.

import type { ImportPlan } from './parseEnvelope'

type LibraryToSpecIds = ReadonlyMap<string, ReadonlyMap<string, string>>

interface PendingEnvSpec {
  /** Local id of the env spec in the source envelope. */
  name?: unknown
  /**
   * importWorkflowSpecToInternal wraps the env spec body under `data` and
   * stashes the library name as `data._libraryName` (mirroring the editor
   * spec shape, where data is the freeform blob).
   */
  data?: { _libraryName?: unknown } | unknown
  /**
   * Some legacy paths put library name at the top level of the pending entry.
   * Accept both shapes to keep the helper resilient across importer versions.
   */
  libraryName?: unknown
}

function readLibraryName(entry: PendingEnvSpec): string | null {
  const nested = (entry.data as { _libraryName?: unknown } | undefined)?._libraryName
  if (typeof nested === 'string' && nested) return nested
  if (typeof entry.libraryName === 'string' && entry.libraryName) return entry.libraryName
  return null
}

/**
 * For each workflow spec in `plan.specs`, look at `data._pendingEnvironmentSpecs[]`
 * and remap each `(libraryName, name)` to the env spec id created (or reused)
 * by importLibrariesFromZip. Writes the resolved ids into `data.environmentSpecIds`,
 * preserving any pre-existing ids on the spec, and strips `_pendingEnvironmentSpecs`.
 *
 * Specs whose pending entries can't be resolved (env library missing from the
 * ZIP, env spec name missing inside it) are skipped silently — the runtime
 * link via specification_environment still survives and the workflow loads,
 * the env header just shows fewer chips.
 */
export function injectWorkflowEnvSpecIds(plan: ImportPlan, envSpecIdsByLibraryAndName: LibraryToSpecIds): void {
  for (const spec of plan.specs) {
    let parsed: Record<string, unknown>
    try {
      const candidate = JSON.parse(spec.dataJson)
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
      parsed = candidate as Record<string, unknown>
    } catch {
      continue
    }

    const pending = parsed._pendingEnvironmentSpecs
    if (!Array.isArray(pending)) continue

    const resolved: string[] = []
    for (const entry of pending as PendingEnvSpec[]) {
      if (!entry || typeof entry !== 'object') continue
      const libraryName = readLibraryName(entry)
      if (!libraryName) continue
      const name = entry.name
      if (typeof name !== 'string' || !name) continue
      const libMap = envSpecIdsByLibraryAndName.get(libraryName)
      if (!libMap) continue
      const id = libMap.get(name)
      if (id) resolved.push(id)
    }

    delete parsed._pendingEnvironmentSpecs

    if (resolved.length > 0) {
      const existing = Array.isArray(parsed.environmentSpecIds)
        ? (parsed.environmentSpecIds.filter((x) => typeof x === 'string') as string[])
        : []
      // De-dup while preserving insertion order: existing ids first, new ids second.
      const merged: string[] = []
      const seen = new Set<string>()
      for (const id of [...existing, ...resolved]) {
        if (seen.has(id)) continue
        seen.add(id)
        merged.push(id)
      }
      parsed.environmentSpecIds = merged
    }

    spec.dataJson = JSON.stringify(parsed)
  }
}
