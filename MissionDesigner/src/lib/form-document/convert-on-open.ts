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

import type { Edge } from '@xyflow/react'
import { toast } from 'sonner'
import { useFlowStore } from '@/stores/flowStore'
import type { StepNodeData } from '@/types/nodes'
import { convertToFixedBar } from './fixed-bar'

/** Outgoing connection conditions of a node (edge data carries them). */
export function outgoingConditions(nodeId: string, edges: Edge[]): string[] {
  return edges
    .filter((e) => e.source === nodeId)
    .map((e) => (e.data as { condition?: string } | undefined)?.condition)
    .filter((c): c is string => !!c)
}

/**
 * Convert a legacy screen step to the fixed bar when it is opened in an editable spec. Returns the
 * fields to write (including a kept `routingProblem`) and the one-time note, or null when there is
 * nothing to do (already fixed, not a screen step, or the spec is read-only / Effective).
 */
export function legacyStepConversion(
  nodeType: string,
  data: StepNodeData,
  edges: Edge[],
  nodeId: string,
  canEdit: boolean,
): { data: StepNodeData; note: string | null } | null {
  if (!canEdit || data.buttonBar) return null
  if (nodeType !== 'userInteractionStep' && nodeType !== 'yesNoStep') return null
  const r = convertToFixedBar(nodeType, data, outgoingConditions(nodeId, edges))
  if (!r.changed) return null
  return {
    data: r.routingProblem ? { ...r.data, routingProblem: r.routingProblem, routingValues: r.routingValues } : r.data,
    note: r.note,
  }
}

/** Store-level variant for the form modal's open path; idempotent. */
export function convertStepInStore(nodeId: string, canEdit: boolean): void {
  const { nodes, edges, updateNodeData } = useFlowStore.getState()
  const node = nodes.find((n) => n.id === nodeId)
  if (!node) return
  const r = legacyStepConversion(node.type ?? '', node.data as StepNodeData, edges, nodeId, canEdit)
  if (!r) return
  updateNodeData(nodeId, r.data)
  if (r.note) toast.info(r.note)
}
