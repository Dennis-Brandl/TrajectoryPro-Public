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

import type { Edge, Node } from '@xyflow/react'
import { partitionCatchNetworks, type PartitionStep } from '@/lib/canvas/catch-network-partition'
import { NODE_TYPE_TO_STEP_TYPE } from '@/lib/packageFormat/export-types'
import { TRY_MODE_LABELS, isOperatorMode } from '@/lib/try-modes'
import type { TrySpec } from '@/types/nodes'

/**
 * Advisory warnings for the CATCH networks that Operator Stop / Operator Abort rows route to
 * (spec 2026-11-06 C5, C14). Never blocks export.
 */
export function collectOperatorCleanupWarnings(nodes: Node[], edges: Edge[], workflowTrySpecs: TrySpec[]): string[] {
  const operatorRows = workflowTrySpecs.filter((t) => isOperatorMode(t.mode))
  if (operatorRows.length === 0) return []

  const steps: PartitionStep[] = nodes.map((n) => ({
    oid: n.id,
    step_type: NODE_TYPE_TO_STEP_TYPE[(n.type ?? 'start') as keyof typeof NODE_TYPE_TO_STEP_TYPE] ?? 'UNKNOWN',
    catch_id: (n.data as { catchId?: string }).catchId,
  }))
  const part = partitionCatchNetworks(
    steps,
    edges.map((e) => ({ from_step_id: e.source, to_step_id: e.target })),
  )

  const warnings: string[] = []
  const seen = new Set<string>()
  for (const row of operatorRows) {
    const network = part.networksByCatchId.get(row.catch_id)
    if (!network) continue
    const label = TRY_MODE_LABELS[row.mode]
    for (const n of nodes) {
      if (!network.has(n.id)) continue
      const data = n.data as {
        label?: string
        returnConfig?: { command?: string }
        actionProxyConfig?: { environment_oid?: string }
      }
      const name = data.label || n.id
      const messages: string[] = []
      if (n.type === 'return') {
        const command = data.returnConfig?.command ?? 'ABANDON'
        if (command !== 'ABANDON')
          messages.push(`RETURN "${name}" is in the ${label} cleanup; its ${command} command is treated as finish.`)
      }
      if (data.actionProxyConfig?.environment_oid === 'broker-env')
        messages.push(`"${name}" is a Distributed Workflow action; these are not supported in an ${label} cleanup.`)
      for (const m of messages) {
        if (!seen.has(m)) {
          seen.add(m)
          warnings.push(m)
        }
      }
    }
  }
  return warnings
}

/** Toast text for the cleanup warnings (same ' · ' separator as the Gate warnings toast). */
export function formatOperatorCleanupWarnings(warnings: string[]): string {
  return `Operator cleanup: ${warnings.join(' · ')}`
}
