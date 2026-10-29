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
import type { ResourceSpec } from '@/types/nodes'
import type { Specification } from '@/types/library'

export interface ResourceGroup {
  label: string
  sourceType: 'workflow' | 'environment'
  sourceOid: string
  resources: ResourceSpec[]
}

interface SpecificationData {
  parentSpecificationId?: string
  environmentSpecIds?: string[]
  workflowResources?: ResourceSpec[]
  resources?: ResourceSpec[] // environment specs use this field
  [key: string]: unknown
}

/**
 * Gathers all Resources from the workflow hierarchy:
 * current workflow, its environments, parent workflows, and parent environments.
 * Returns grouped results for display and a flat map of all resources by name.
 */
export function useAvailableResources() {
  const workflowResources = useFlowStore((s) => s.workflowResources)
  const specifications = useLibraryStore((s) => s.specifications)
  const selectedSpecificationId = useLibraryStore((s) => s.selectedSpecificationId)

  return useMemo(() => {
    const groups: ResourceGroup[] = []
    const allResources = new Map<string, ResourceSpec>()

    // Build an ID index for O(1) lookups instead of O(n) per call
    const specIndex = new Map<string, Specification>()
    for (const specs of specifications.values()) {
      for (const spec of specs) {
        specIndex.set(spec.id, spec)
      }
    }

    const findSpecById = (specId: string): Specification | null => {
      return specIndex.get(specId) ?? null
    }

    // Helper to get resources from environment specs
    const getEnvironmentResources = (envSpecIds: string[]): ResourceGroup[] => {
      const envGroups: ResourceGroup[] = []
      for (const envSpecId of envSpecIds) {
        const envSpec = findSpecById(envSpecId)
        if (envSpec) {
          const envData = envSpec.data as SpecificationData | undefined
          const envResources = envData?.resources || []
          if (envResources.length > 0) {
            envGroups.push({
              label: `Env: ${envSpec.name}`,
              sourceType: 'environment',
              sourceOid: envSpec.id,
              resources: envResources,
            })
          }
        }
      }
      return envGroups
    }

    // 1. Current workflow resources (live editing state)
    if (workflowResources.length > 0) {
      groups.push({
        label: 'Workflow Resources',
        sourceType: 'workflow',
        sourceOid: selectedSpecificationId || '',
        resources: workflowResources,
      })
      for (const r of workflowResources) {
        allResources.set(r.name, r)
      }
    }

    // 2. Current workflow's environment resources
    if (selectedSpecificationId) {
      const currentSpec = findSpecById(selectedSpecificationId)
      const currentData = currentSpec?.data as SpecificationData | undefined
      const envSpecIds = currentData?.environmentSpecIds || []

      for (const group of getEnvironmentResources(envSpecIds)) {
        const filtered = group.resources.filter((r) => !allResources.has(r.name))
        if (filtered.length > 0) {
          groups.push({
            label: group.label,
            sourceType: group.sourceType,
            sourceOid: group.sourceOid,
            resources: filtered,
          })
          for (const r of filtered) {
            allResources.set(r.name, r)
          }
        }
      }

      // 3. Walk up the parent chain
      let parentId = currentData?.parentSpecificationId
      while (parentId) {
        const parentSpec = findSpecById(parentId)
        if (!parentSpec) break

        const parentData = parentSpec.data as SpecificationData | undefined
        const parentResources = parentData?.workflowResources || []

        // Parent workflow resources
        const filteredParent = parentResources.filter((r) => !allResources.has(r.name))
        if (filteredParent.length > 0) {
          groups.push({
            label: `Parent: ${parentSpec.name}`,
            sourceType: 'workflow',
            sourceOid: parentSpec.id,
            resources: filteredParent,
          })
          for (const r of filteredParent) {
            allResources.set(r.name, r)
          }
        }

        // Parent environment resources
        const parentEnvSpecIds = parentData?.environmentSpecIds || []
        for (const group of getEnvironmentResources(parentEnvSpecIds)) {
          const filtered = group.resources.filter((r) => !allResources.has(r.name))
          if (filtered.length > 0) {
            groups.push({
              label: group.label,
              sourceType: group.sourceType,
              sourceOid: group.sourceOid,
              resources: filtered,
            })
            for (const r of filtered) {
              allResources.set(r.name, r)
            }
          }
        }

        parentId = parentData?.parentSpecificationId
      }
    }

    return { groups, allResources }
  }, [workflowResources, specifications, selectedSpecificationId])
}
