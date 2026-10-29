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
import type { ValueTypeSpec } from '@/types/nodes'
import type { Specification } from '@/types/library'

export interface ValueTypeGroup {
  label: string
  valueTypes: ValueTypeSpec[]
}

interface SpecificationData {
  parentSpecificationId?: string
  environmentSpecIds?: string[]
  valueTypes?: ValueTypeSpec[]
  [key: string]: unknown
}

/**
 * Gathers Value Types from the environments associated with the current
 * workflow and its parent chain. First-wins dedupe by type name
 * (case-insensitive); types with no entries are skipped (nothing to copy).
 * Feeds the "add property from Value Type" pickers only — there are no
 * validation consumers, because a created property retains no link to its
 * type.
 */
export function useAvailableValueTypes(): { groups: ValueTypeGroup[]; allValueTypes: ValueTypeSpec[] } {
  const specifications = useLibraryStore((s) => s.specifications)
  const selectedSpecificationId = useLibraryStore((s) => s.selectedSpecificationId)

  return useMemo(() => {
    const groups: ValueTypeGroup[] = []
    const allValueTypes: ValueTypeSpec[] = []
    const seen = new Set<string>()

    const specIndex = new Map<string, Specification>()
    for (const specs of specifications.values()) {
      for (const spec of specs) specIndex.set(spec.id, spec)
    }

    const collectFromEnvs = (envSpecIds: string[]) => {
      for (const envSpecId of envSpecIds) {
        const envSpec = specIndex.get(envSpecId)
        if (!envSpec) continue
        const envData = envSpec.data as SpecificationData | undefined
        const candidates = (envData?.valueTypes ?? []).filter(
          (vt) => !!vt.name && vt.entries.some((e) => e.name.trim() !== '') && !seen.has(vt.name.toLowerCase()),
        )
        if (candidates.length === 0) continue
        groups.push({ label: `Env: ${envSpec.name}`, valueTypes: candidates })
        for (const vt of candidates) {
          seen.add(vt.name.toLowerCase())
          allValueTypes.push(vt)
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

    return { groups, allValueTypes }
  }, [specifications, selectedSpecificationId])
}
