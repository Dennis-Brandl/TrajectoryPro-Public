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

// Export advisories for the fixed button row (spec 2026-11-11): Back needs a screen step upstream,
// and going back over a resource step repeats its Acquire / Release. Advisories never block export.

import type { Edge } from '@xyflow/react'
import type { StepNodeData, StepResourceCommand, WorkflowNode } from '@/types/nodes'
import type { Specification } from '@/types/library'

const isScreen = (n: WorkflowNode | undefined): boolean => n?.type === 'userInteractionStep' || n?.type === 'yesNoStep'

// Back never crosses a parallel split, a join, or a sub-workflow boundary (and the start of the level).
const BARRIER_TYPES = new Set(['parallel', 'waitAll', 'waitAny', 'workflowProxy', 'start'])

export function collectFixedBarWarnings(nodes: WorkflowNode[], edges: Edge[]): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const incoming = new Map<string, string[]>()
  for (const e of edges) incoming.set(e.target, [...(incoming.get(e.target) ?? []), e.source])

  const out: string[] = []
  for (const n of nodes) {
    const d = n.data as StepNodeData
    if (!isScreen(n) || d.buttonBar === undefined || d.allowBack !== true) continue
    const name = d.label || n.id

    // Plain steps reachable upstream without crossing a screen or a barrier.
    const reach = new Set<string>()
    const queue = [...(incoming.get(n.id) ?? [])]
    while (queue.length > 0) {
      const id = queue.shift() as string
      if (reach.has(id) || id === n.id) continue
      const up = byId.get(id)
      if (!up || isScreen(up) || BARRIER_TYPES.has(up.type ?? '')) continue
      reach.add(id)
      queue.push(...(incoming.get(id) ?? []))
    }
    // A plain step is "good" when some path from it upstream reaches a screen (no barrier on the way).
    const feedsScreen = (id: string, good: Set<string>): boolean =>
      (incoming.get(id) ?? []).some((p) => isScreen(byId.get(p)) || good.has(p))
    const good = new Set<string>()
    for (let changed = true; changed; ) {
      changed = false
      for (const id of reach) {
        if (!good.has(id) && feedsScreen(id, good)) {
          good.add(id)
          changed = true
        }
      }
    }
    const reachesScreen = (incoming.get(n.id) ?? []).some((p) => isScreen(byId.get(p)) || good.has(p))

    if (!reachesScreen) {
      out.push(`${name}: Back will never be available here`)
      continue
    }
    // Only steps on a path that really reaches a screen count.
    for (const id of good) {
      const b = byId.get(id) as WorkflowNode
      for (const cmd of ((b.data as StepNodeData).resourceCommands ?? []) as StepResourceCommand[]) {
        if (cmd.commandType !== 'Acquire' && cmd.commandType !== 'Release') continue
        const verb = cmd.commandType === 'Acquire' ? 'acquires' : 'releases'
        out.push(`${name}: Going back here ${verb} «${cmd.resourceName}» again when the operator moves forward`)
      }
    }
  }
  return out
}

/** The same checks for the parent workflow and every child workflow (as validateWorkflowWithChildren walks them). */
export function collectFixedBarWarningsWithChildren(
  parentNodes: WorkflowNode[],
  parentEdges: Edge[],
  parentSpecId: string,
  allSpecs: Specification[],
): string[] {
  const out = collectFixedBarWarnings(parentNodes, parentEdges)
  const walk = (specId: string) => {
    for (const child of allSpecs) {
      const data = child.data as { parentSpecificationId?: string; nodes?: WorkflowNode[]; edges?: Edge[] } | null
      if (data?.parentSpecificationId !== specId) continue
      for (const w of collectFixedBarWarnings(data.nodes ?? [], data.edges ?? [])) out.push(`${child.name} — ${w}`)
      walk(child.id)
    }
  }
  walk(parentSpecId)
  return out
}
