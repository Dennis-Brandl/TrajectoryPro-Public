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

// AFTER buildImportBatch produces a BatchSaveRequest (and BEFORE runBatchSave
// persists it), parseEnvelope has already stripped `embeddedWorkflowSpecId`
// from every workflowProxy node into plan.proxyRefs[] (intentional, for clean
// DB serialization). buildImportBatch copies plan.specs[].dataJson into
// batch.specs[].data as a snapshot — mutating plan after that point has no
// effect on what runBatchSave persists. The editor's canvas double-click
// handler reads node.data.embeddedWorkflowSpecId to navigate into the embedded
// sub-workflow — if that field is absent the double-click does nothing even
// though the proxyReference row exists.
//
// This helper mirrors the same dual-storage fix used for env spec ids
// (injectWorkflowEnvSpecIds.ts): walk batch.proxyRefs[], find the parent
// spec's data.nodes[] entry by nodeId, and write embeddedWorkflowSpecId +
// subWorkflowMode back into the node data. batch.proxyRefs already carries
// the remapped new target ids — no separate idMap parameter is needed.
// The parent spec's data string is re-serialized in place before runBatchSave.

import type { BatchSaveRequest } from '../batchSave/requestSchema'

/**
 * For each proxy ref in `batch.proxyRefs`, write the remapped target spec id
 * back into the parent spec's node data so the editor canvas can navigate into
 * the embedded sub-workflow via double-click.
 *
 * Skips silently when:
 * - The parent spec (by `parentSpecificationId`) is not found in `batch.specs`
 * - The parent spec's `data` field cannot be parsed as an object
 * - The node id is not present in the parent's `data.nodes[]`
 *
 * Mutates `batch.specs[].data` in place.
 */
export function injectEmbeddedWorkflowSpecIds(batch: BatchSaveRequest): void {
  // Build a quick lookup: new id → spec entry (for O(1) parent resolution).
  // Only 'create' entries carry a writable `data` string.
  const specById = new Map<string, (typeof batch.specs)[number] & { op: 'create'; data: string }>()
  for (const spec of batch.specs) {
    if (spec.op === 'create') {
      specById.set(spec.id, spec as (typeof batch.specs)[number] & { op: 'create'; data: string })
    }
  }

  for (const ref of batch.proxyRefs) {
    if (ref.op !== 'create') continue

    const parentSpec = specById.get(ref.parentSpecificationId)
    if (!parentSpec) continue // parent spec not in batch — skip

    let parsed: Record<string, unknown>
    try {
      const candidate = JSON.parse(parentSpec.data)
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
      parsed = candidate as Record<string, unknown>
    } catch {
      continue
    }

    const nodes = parsed.nodes
    if (!Array.isArray(nodes)) continue

    let mutated = false
    for (const rawNode of nodes) {
      if (!rawNode || typeof rawNode !== 'object') continue
      const node = rawNode as Record<string, unknown>
      if (node.id !== ref.nodeId) continue

      // Ensure node.data exists as an object.
      if (!node.data || typeof node.data !== 'object' || Array.isArray(node.data)) {
        node.data = {}
      }
      const nodeData = node.data as Record<string, unknown>

      nodeData.embeddedWorkflowSpecId = ref.targetSpecificationId
      nodeData.subWorkflowMode = 'embedded'

      mutated = true
      break
    }

    if (mutated) {
      parentSpec.data = JSON.stringify(parsed)
    }
  }
}
