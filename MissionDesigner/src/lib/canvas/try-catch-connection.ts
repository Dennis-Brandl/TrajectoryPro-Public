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
import type { WorkflowNode } from '@/types/nodes'
import { NODE_TYPE_TO_STEP_TYPE } from '@/lib/packageFormat/export-types'
import { partitionCatchNetworks, type PartitionStep } from './catch-network-partition'

/** Returns false if the proposed edge violates a TRY/CATCH/RETURN structural rule. */
export function isTryCatchConnectionValid(
  connection: { source: string; target: string },
  nodes: WorkflowNode[],
  edges: Pick<Edge, 'source' | 'target'>[],
): boolean {
  const source = nodes.find((n) => n.id === connection.source)
  const target = nodes.find((n) => n.id === connection.target)
  if (!source || !target) return false
  if (target.type === 'catch') return false // CATCH takes no incoming
  if (source.type === 'return') return false // RETURN emits no outgoing

  const steps: PartitionStep[] = nodes.map((n) => ({
    oid: n.id,
    step_type: NODE_TYPE_TO_STEP_TYPE[(n.type ?? 'start') as keyof typeof NODE_TYPE_TO_STEP_TYPE] ?? 'UNKNOWN',
    catch_id: (n.data as { catchId?: string }).catchId,
  }))
  // Include the edge being drawn. A new connection that EXTENDS a catch network
  // (e.g. branching a SELECT 1 inside the catch path to a freshly-placed step)
  // must be judged against the partition that results AFTER the edge exists — not
  // before. Otherwise the new target is still classified "main flow" (it isn't
  // reachable from the CATCH until this very edge is added) and the legitimate
  // branch is wrongly rejected as a cross-network edge. Because the partition's
  // BFS only follows edges OUT of a CATCH, this still blocks wiring a main-flow
  // node INTO a catch network (the candidate edge can't pull the source in).
  const conns = [
    ...edges.map((e) => ({ from_step_id: e.source, to_step_id: e.target })),
    { from_step_id: connection.source, to_step_id: connection.target },
  ]
  const part = partitionCatchNetworks(steps, conns)
  if (part.catchNetworkStepOids.has(connection.source) !== part.catchNetworkStepOids.has(connection.target))
    return false
  return true
}
