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

import type { ParameterSpec, WorkflowNode } from '@/types/nodes'
import { generateOID, WORKER_INTERNAL } from '@/lib/snowflake'

/** The four runtime-supplied CATCH trigger-info outputs (order shown in the panel). */
export const CATCH_OUTPUT_NAMES = ['Message', 'Reason', 'Step', 'StepID'] as const

const DESCRIPTIONS: Record<string, string> = {
  Message: 'Error message from the failed action (empty if none)',
  Reason: 'Failure mode that fired: ERROR, ABORT, or TIMEOUT',
  Step: 'Label of the step whose TRY fired',
  StepID: 'OID of the step whose TRY fired',
}

/** Build the four default outputs for a freshly-created CATCH node. */
export function defaultCatchOutputs(): ParameterSpec[] {
  return CATCH_OUTPUT_NAMES.map((name) => ({
    id: generateOID(WORKER_INTERNAL),
    name,
    description: DESCRIPTIONS[name],
  }))
}

/**
 * Backfill a CATCH node's outputs to the canonical four. Existing rows are
 * kept untouched (their explicit targets keep working); only missing names
 * are appended. Returns the input array unchanged when nothing is missing,
 * so callers can cheaply detect the no-op case by reference.
 */
export function withCanonicalCatchOutputs(outputs: ParameterSpec[] | undefined): ParameterSpec[] {
  const existing = outputs ?? []
  const missing = CATCH_OUTPUT_NAMES.filter((name) => !existing.some((o) => o.name === name))
  if (missing.length === 0 && outputs) return outputs
  return [
    ...existing,
    ...missing.map((name) => ({
      id: generateOID(WORKER_INTERNAL),
      name,
      description: DESCRIPTIONS[name],
    })),
  ]
}

/**
 * Canvas-hydration normalization: every CATCH node in the array carries the
 * canonical outputs afterwards. Untouched nodes keep their references, and
 * when nothing needs backfilling the input array itself is returned, so
 * callers (and dirty tracking) see a no-op as a no-op.
 */
export function normalizeCatchOutputsInNodes(nodes: WorkflowNode[]): WorkflowNode[] {
  let changed = false
  const result = nodes.map((node) => {
    if (node.type !== 'catch') return node
    const outputs = (node.data as { outputs?: ParameterSpec[] }).outputs
    const normalized = withCanonicalCatchOutputs(outputs)
    if (normalized === outputs) return node
    changed = true
    return { ...node, data: { ...node.data, outputs: normalized } }
  })
  return changed ? result : nodes
}
