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
import { useAvailableParameters } from '@/hooks/useAvailableParameters'
import type { ExtraPickerGroup } from '@/components/properties/ValuePropertyInput'
import type { ParameterSpec, StepNodeData } from '@/types/nodes'

export interface SourcePickerOptions {
  /** Spec 2026-09-04 §5.2.4: prepend the current node's own named input parameters as
   *  "Step Input Parameters" — used by SELECT 1's compare-input picker so a bound Action
   *  Property routed through an input can drive the branch. */
  includeOwnInputs?: boolean
}

/**
 * Extra picker groups for Source dropdowns: workflow input/output
 * parameters, parent workflow input/output parameters, and the output
 * parameters of every other step in the current workflow.
 *
 * Pass the current node's id to exclude that node's own outputs from
 * the per-step groups. Pass `opts.includeOwnInputs` to additionally
 * prepend the current node's own Input Parameters as a leading group.
 */
export function useSourcePickerExtraGroups(currentNodeId?: string, opts?: SourcePickerOptions): ExtraPickerGroup[] {
  const includeOwnInputs = opts?.includeOwnInputs === true
  const { workflowInputParams, workflowOutputParams, parentOutputParams, parentInputParams } = useAvailableParameters()
  const nodes = useFlowStore((s) => s.nodes)

  return useMemo(() => {
    const groups: ExtraPickerGroup[] = []

    if (includeOwnInputs && currentNodeId) {
      const self = nodes.find((n) => n.id === currentNodeId)
      const ownInputs = (((self?.data as StepNodeData | undefined)?.inputs ?? []) as ParameterSpec[]).filter(
        (p) => p.name,
      )
      if (ownInputs.length > 0) {
        groups.push({
          label: 'Step Input Parameters',
          items: ownInputs.map((p) => ({ value: p.name, display: p.name })),
        })
      }
    }

    if (workflowInputParams.length > 0) {
      groups.push({
        label: 'Workflow Input Parameters',
        items: workflowInputParams.map((p) => ({ value: p.name, display: p.name })),
      })
    }
    if (workflowOutputParams.length > 0) {
      groups.push({
        label: 'Workflow Output Parameters',
        items: workflowOutputParams.map((p) => ({ value: p.name, display: p.name })),
      })
    }
    if (parentOutputParams.length > 0) {
      groups.push({
        label: 'Parent Output Parameters',
        items: parentOutputParams.map((p) => ({ value: p.name, display: p.name })),
      })
    }
    if (parentInputParams.length > 0) {
      groups.push({
        label: 'Parent Input Parameters',
        items: parentInputParams.map((p) => ({ value: p.name, display: p.name })),
      })
    }

    for (const node of nodes) {
      if (node.id === currentNodeId) continue
      const data = node.data as StepNodeData
      const outputs = data.outputs as ParameterSpec[] | undefined
      if (!outputs || outputs.length === 0) continue
      const usableOutputs = outputs.filter((o) => o.name || o.target)
      if (usableOutputs.length === 0) continue
      // Catch nodes usually share the default "CATCH" label — append the catch id so
      // multiple catches stay distinguishable in the picker.
      const catchId = node.type === 'catch' ? (data as { catchId?: string }).catchId : undefined
      groups.push({
        label: `Step: ${data.label || node.id}${catchId ? ` (${catchId})` : ''}`,
        items: usableOutputs.map((o) => ({
          value: o.name || o.target || o.id,
          display: o.name || o.target || o.id,
        })),
      })
    }

    return groups
  }, [
    workflowInputParams,
    workflowOutputParams,
    parentOutputParams,
    parentInputParams,
    nodes,
    currentNodeId,
    includeOwnInputs,
  ])
}
