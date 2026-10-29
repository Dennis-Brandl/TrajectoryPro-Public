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
import { useFlowStore } from '@/stores/flowStore'
import { useLibraryStore } from '@/stores/libraryStore'
import type { ValueSpec } from '@/types/nodes'
import type { Specification } from '@/types/library'
import { buildDotNotation, HIDDEN_ENTRY_NAMES } from '@/lib/value-utils'

export interface ValuePropertyGroup {
  label: string
  values: ValueSpec[]
  /** Specification ID for write-back targeting (null = current workflow via flowStore) */
  specId: string | null
}

export interface WritableLevel {
  label: string
  /** null = current workflow (flowStore), otherwise spec ID for library store updates */
  specId: string | null
}

interface SpecificationData {
  parentSpecificationId?: string
  environmentSpecIds?: string[]
  workflowValues?: ValueSpec[]
  [key: string]: unknown
}

/**
 * Gathers all Value Property names from the workflow hierarchy:
 * current workflow, its environments, parent workflows, and parent environments.
 * Returns grouped results for display, a flat set of all names,
 * all entry refs in dot notation, and writable levels for property creation.
 */
export function useAvailableValueProperties() {
  const workflowValues = useFlowStore((s) => s.workflowValues)
  const specifications = useLibraryStore((s) => s.specifications)
  const selectedSpecificationId = useLibraryStore((s) => s.selectedSpecificationId)

  return useMemo(() => {
    const groups: ValuePropertyGroup[] = []
    const seenNames = new Set<string>()
    const allEntryRefs = new Set<string>()
    const writableLevels: WritableLevel[] = []

    // Helper to find a specification by ID across all libraries
    const findSpecById = (specId: string): Specification | null => {
      for (const specs of specifications.values()) {
        const found = specs.find((s) => s.id === specId)
        if (found) return found
      }
      return null
    }

    // Helper to collect entry refs from values (excludes hidden entries like Description)
    const collectEntryRefs = (values: ValueSpec[]) => {
      for (const v of values) {
        if (!v.name) continue
        for (const entry of v.entries) {
          if (entry.name && !HIDDEN_ENTRY_NAMES.has(entry.name)) {
            allEntryRefs.add(buildDotNotation(v.name, entry.name))
          }
        }
      }
    }

    // Helper to get values from environment specs
    const getEnvironmentValues = (envSpecIds: string[]): ValuePropertyGroup[] => {
      const envGroups: ValuePropertyGroup[] = []
      for (const envSpecId of envSpecIds) {
        const envSpec = findSpecById(envSpecId)
        if (envSpec) {
          const envData = envSpec.data as Record<string, unknown> | undefined
          // Environment specs store value properties as 'values', not 'workflowValues'
          const envValues = (envData?.values || envData?.workflowValues || []) as ValueSpec[]
          if (envValues.length > 0) {
            envGroups.push({
              label: `Env: ${envSpec.name}`,
              values: envValues,
              specId: envSpecId,
            })
          }
        }
      }
      return envGroups
    }

    // 1. Current workflow values (live editing state)
    writableLevels.push({ label: 'Current Workflow', specId: null })
    if (workflowValues.length > 0) {
      groups.push({ label: 'Workflow Values', values: workflowValues, specId: null })
      for (const v of workflowValues) {
        seenNames.add(v.name)
      }
      collectEntryRefs(workflowValues)
    }

    // 2. Current workflow's environment values
    if (selectedSpecificationId) {
      const currentSpec = findSpecById(selectedSpecificationId)
      const currentData = currentSpec?.data as SpecificationData | undefined
      const envSpecIds = currentData?.environmentSpecIds || []

      for (const group of getEnvironmentValues(envSpecIds)) {
        const filtered = group.values.filter((v) => !seenNames.has(v.name))
        if (filtered.length > 0) {
          groups.push({ label: group.label, values: filtered, specId: group.specId })
          for (const v of filtered) {
            seenNames.add(v.name)
          }
          collectEntryRefs(filtered)
        }
      }

      // 3. Walk up the parent chain
      let parentId = currentData?.parentSpecificationId
      while (parentId) {
        const parentSpec = findSpecById(parentId)
        if (!parentSpec) break

        const parentData = parentSpec.data as SpecificationData | undefined
        const parentValues = parentData?.workflowValues || []

        // Add parent as a writable level
        writableLevels.push({ label: `Parent: ${parentSpec.name}`, specId: parentId })

        // Parent workflow values
        const filteredParent = parentValues.filter((v) => !seenNames.has(v.name))
        if (filteredParent.length > 0) {
          groups.push({
            label: `Parent: ${parentSpec.name}`,
            values: filteredParent,
            specId: parentId,
          })
          for (const v of filteredParent) {
            seenNames.add(v.name)
          }
          collectEntryRefs(filteredParent)
        }

        // Parent environment values
        const parentEnvSpecIds = parentData?.environmentSpecIds || []
        for (const group of getEnvironmentValues(parentEnvSpecIds)) {
          const filtered = group.values.filter((v) => !seenNames.has(v.name))
          if (filtered.length > 0) {
            groups.push({ label: group.label, values: filtered, specId: group.specId })
            for (const v of filtered) {
              seenNames.add(v.name)
            }
            collectEntryRefs(filtered)
          }
        }

        parentId = parentData?.parentSpecificationId
      }
    }

    return { groups, allNames: seenNames, allEntryRefs, writableLevels }
  }, [workflowValues, specifications, selectedSpecificationId])
}
