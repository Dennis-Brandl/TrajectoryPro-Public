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
import type { ParameterSpec } from '@/types/nodes'

interface SpecificationData {
  parentSpecificationId?: string
  workflowInputs?: ParameterSpec[]
  workflowOutputs?: ParameterSpec[]
  [key: string]: unknown
}

/**
 * Gathers workflow input/output parameters and parent output parameters
 * separately from value properties.
 *
 * - workflowInputParams: the current workflow's input parameters (from flowStore)
 * - workflowOutputParams: the current workflow's output parameters (from flowStore)
 * - parentOutputParams: the immediate parent workflow's output parameters
 * - parentInputParams: the immediate parent workflow's input parameters
 */
export function useAvailableParameters() {
  const workflowInputs = useFlowStore((s) => s.workflowInputs)
  const workflowOutputs = useFlowStore((s) => s.workflowOutputs)
  const specifications = useLibraryStore((s) => s.specifications)
  const selectedSpecificationId = useLibraryStore((s) => s.selectedSpecificationId)

  return useMemo(() => {
    const workflowInputParams: ParameterSpec[] = workflowInputs.filter((p) => p.name)
    const workflowOutputParams: ParameterSpec[] = workflowOutputs.filter((p) => p.name)

    const parentOutputParams: ParameterSpec[] = []
    const parentInputParams: ParameterSpec[] = []
    let isChildWorkflow = false

    if (selectedSpecificationId) {
      // Find current spec to get parentSpecificationId
      let currentSpec = null
      for (const specs of specifications.values()) {
        const found = specs.find((s) => s.id === selectedSpecificationId)
        if (found) {
          currentSpec = found
          break
        }
      }

      if (currentSpec) {
        const currentData = currentSpec.data as SpecificationData | undefined
        const parentId = currentData?.parentSpecificationId
        if (parentId) {
          isChildWorkflow = true
          for (const specs of specifications.values()) {
            const parentSpec = specs.find((s) => s.id === parentId)
            if (parentSpec) {
              const parentData = parentSpec.data as SpecificationData | undefined
              const outputs = parentData?.workflowOutputs || []
              for (const o of outputs) {
                if (o.name) parentOutputParams.push(o)
              }
              const inputs = parentData?.workflowInputs || []
              for (const i of inputs) {
                if (i.name) parentInputParams.push(i)
              }
              break
            }
          }
        }
      }
    }

    return { workflowInputParams, workflowOutputParams, parentOutputParams, parentInputParams, isChildWorkflow }
  }, [workflowInputs, workflowOutputs, specifications, selectedSpecificationId])
}
