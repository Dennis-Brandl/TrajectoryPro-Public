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

import type { WorkflowNode } from '@/types/nodes'

export interface CatchTrigger {
  stepId: string
  stepLabel: string
  mode: 'ERROR' | 'ABORT' | 'TIMEOUT'
}

interface TrySpecLike {
  mode: 'ERROR' | 'ABORT' | 'TIMEOUT'
  catch_id: string
}

const MODE_ORDER: Record<CatchTrigger['mode'], number> = { ERROR: 0, ABORT: 1, TIMEOUT: 2 }

/**
 * Reverse-lookup: every TRY (step + mode) that routes to the given catch_id.
 * Pure — derives from the node list, no store access. Mirrors the traversal in
 * flowStore.renameCatchId.
 */
export function findCatchTriggers(
  nodes: WorkflowNode[],
  catchId: string,
  workflowTries: TrySpecLike[] = [],
): CatchTrigger[] {
  const id = catchId.trim()
  if (!id) return []

  const out: CatchTrigger[] = []
  // Workflow-level rows first (spec 2026-08-22 §4.4): stepId '' is the sentinel the
  // "Triggered by" click handler maps to "deselect all" (which opens the workflow panel).
  for (const spec of workflowTries) {
    if (spec.catch_id === id) out.push({ stepId: '', stepLabel: 'Workflow', mode: spec.mode })
  }
  for (const node of nodes) {
    const specs = (node.data as { trySpecifications?: TrySpecLike[] }).trySpecifications
    if (!Array.isArray(specs)) continue
    for (const spec of specs) {
      if (spec.catch_id === id) {
        out.push({ stepId: node.id, stepLabel: (node.data as { label?: string }).label || node.id, mode: spec.mode })
      }
    }
  }
  out.sort((a, b) =>
    a.stepId === ''
      ? -1
      : b.stepId === ''
        ? 1
        : a.stepLabel.localeCompare(b.stepLabel) || MODE_ORDER[a.mode] - MODE_ORDER[b.mode],
  )
  return out
}
