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

import { useMemo } from 'react'
import { useLibraryStore } from '@/stores/libraryStore'
import { useAvailableValueProperties } from '@/hooks/useAvailableValueProperties'
import type { ValueSpec } from '@/types/nodes'
import type { Specification } from '@/types/library'
import { buildDotNotation, HIDDEN_ENTRY_NAMES } from '@/lib/value-utils'

export interface ActionPropertyGroup {
  label: string
  values: ValueSpec[]
  envSpecId: string
}

interface SpecificationData {
  parentSpecificationId?: string
  environmentSpecIds?: string[]
  actionProperties?: ValueSpec[]
  [key: string]: unknown
}

/**
 * Gathers environment Action Properties (spec 2026-09-04 §5.2.1) from the environments attached
 * to the current workflow and its parent chain — the same walk useAvailableValueProperties does.
 * A property whose name matches a Value Property in scope is hidden (export rule 1 would bind it
 * to the Value Property anyway); the same name from several environments is one item (the
 * environment is chosen at export). Entries named in HIDDEN_ENTRY_NAMES are skipped.
 */
export function useAvailableActionProperties(): {
  groups: ActionPropertyGroup[]
  allNames: Set<string>
  allEntryRefs: Set<string>
} {
  const specifications = useLibraryStore((s) => s.specifications)
  const selectedSpecificationId = useLibraryStore((s) => s.selectedSpecificationId)
  const { allNames: valuePropertyNames } = useAvailableValueProperties()

  return useMemo(() => {
    const groups: ActionPropertyGroup[] = []
    const allNames = new Set<string>()
    const allEntryRefs = new Set<string>()

    const specIndex = new Map<string, Specification>()
    for (const specs of specifications.values()) {
      for (const spec of specs) specIndex.set(spec.id, spec)
    }

    const collectFromEnvs = (envSpecIds: string[]) => {
      for (const envSpecId of envSpecIds) {
        const envSpec = specIndex.get(envSpecId)
        if (!envSpec) continue
        const envData = envSpec.data as SpecificationData | undefined
        const candidates: ValueSpec[] = []
        for (const p of envData?.actionProperties ?? []) {
          if (!p.name || valuePropertyNames.has(p.name) || allNames.has(p.name)) continue
          allNames.add(p.name)
          candidates.push(p)
        }
        if (candidates.length === 0) continue
        groups.push({ label: `Env: ${envSpec.name} (Action Properties)`, values: candidates, envSpecId })
        for (const p of candidates) {
          for (const entry of p.entries ?? []) {
            if (entry.name && !HIDDEN_ENTRY_NAMES.has(entry.name))
              allEntryRefs.add(buildDotNotation(p.name, entry.name))
          }
        }
      }
    }

    if (selectedSpecificationId) {
      const currentSpec = specIndex.get(selectedSpecificationId)
      const currentData = currentSpec?.data as SpecificationData | undefined
      collectFromEnvs(currentData?.environmentSpecIds ?? [])

      let parentId = currentData?.parentSpecificationId
      while (parentId) {
        const parentSpec = specIndex.get(parentId)
        if (!parentSpec) break
        const parentData = parentSpec.data as SpecificationData | undefined
        collectFromEnvs(parentData?.environmentSpecIds ?? [])
        parentId = parentData?.parentSpecificationId
      }
    }

    return { groups, allNames, allEntryRefs }
  }, [specifications, selectedSpecificationId, valuePropertyNames])
}
