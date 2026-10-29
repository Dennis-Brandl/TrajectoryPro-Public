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

import type { DanglingReference, WflibxEntityType } from '@/types/wflibx-import'

export interface DanglingScanInputs {
  replacedSpecOids: Set<string>
  replacedActionLibNames: Set<string>
  /** Referrers whose OID is itself being replaced or no-op'd — exclude. */
  excludedReferrerOids: Set<string>
  specifications: Array<{
    id: string
    libraryId: string
    name: string
    entityType: WflibxEntityType
    data: Record<string, unknown>
  }>
}

/**
 * Returns every spec that references an OID slated for replacement or an
 * action-library name slated for replacement. Used to surface dangling
 * references after a workflow-library import commit.
 */
export function findDanglingReferences(inputs: DanglingScanInputs): DanglingReference[] {
  const out: DanglingReference[] = []
  for (const s of inputs.specifications) {
    if (inputs.excludedReferrerOids.has(s.id)) continue
    // (1) workflow specs referencing replaced env-spec OIDs
    const envSpecIds = (s.data.environmentSpecIds as string[] | undefined) ?? []
    for (const id of envSpecIds) {
      if (inputs.replacedSpecOids.has(id)) {
        out.push({
          referrerOid: s.id,
          referrerName: s.name,
          referrerEntityType: s.entityType,
          brokenReferenceTo: id,
        })
      }
    }
    // (2) step specs whose proxy nodes reference replaced workflow OIDs
    const nodes = (s.data.nodes as Array<Record<string, unknown>> | undefined) ?? []
    for (const n of nodes) {
      const d = (n.data ?? {}) as Record<string, unknown>
      const ref = d.referencedSpecId
      if (typeof ref === 'string' && inputs.replacedSpecOids.has(ref)) {
        out.push({
          referrerOid: s.id,
          referrerName: s.name,
          referrerEntityType: s.entityType,
          brokenReferenceTo: ref,
        })
      }
    }
    // (3) env specs referencing replaced action-library names
    const actions = (s.data.included_actions ?? s.data.includedActions ?? []) as Array<{
      action_library?: string
      actionLibrary?: string
    }>
    for (const a of actions) {
      const name = a.action_library ?? a.actionLibrary
      if (name && inputs.replacedActionLibNames.has(name)) {
        out.push({
          referrerOid: s.id,
          referrerName: s.name,
          referrerEntityType: s.entityType,
          brokenReferenceTo: name,
        })
      }
    }
  }
  return out
}
