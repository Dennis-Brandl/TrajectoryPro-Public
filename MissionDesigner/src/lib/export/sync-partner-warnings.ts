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

import type { Node } from '@xyflow/react'
import type { Specification } from '@/types/library'
import type { StepResourceCommand, WorkflowNode } from '@/types/nodes'
import { buildResourceSourceMap } from '@/lib/packageFormat/workflow-exporters'
import { isPartnerCount } from './workflow-validation'

/** Where each resource name is declared, as the export resolves it (workflow first, then its
 *  environments, then up the parent chain). */
type SourceMap = Map<string, { type: 'workflow' | 'environment' }>

/**
 * Advisory warnings (spec 2026-11-27): a Synchronize that waits for more than 2 partners on a
 * SYNC resource declared in the workflow itself. Separate workflows cannot see that resource,
 * only parallel branches of one run can, so this never blocks export.
 */
export function collectSyncPartnerWarnings(nodes: Node[], sources?: SourceMap): string[] {
  const warnings: string[] = []
  const seen = new Set<string>()
  for (const n of nodes) {
    const data = n.data as { label?: string; resourceCommands?: StepResourceCommand[] }
    for (const cmd of data.resourceCommands ?? []) {
      if (cmd.commandType !== 'Synchronize') continue
      // The same resolution the export uses; the command's stored source only when unresolved.
      const declaredIn = sources?.get(cmd.resourceName)?.type ?? cmd.resourceSourceType ?? 'workflow'
      if (declaredIn !== 'workflow') continue
      const moreThanTwo =
        cmd.partnersValueType === 'property' ||
        (cmd.partners !== undefined && (!isPartnerCount(cmd.partners) || Number(cmd.partners.trim()) !== 2))
      if (!moreThanTwo) continue
      const r = cmd.resourceName
      const m = `SYNC "${r}" on "${data.label || n.id}" waits for more than 2 partners, but "${r}" is declared in this workflow, so other workflows cannot join it. Declare it in the environment for separate workflows to synchronize.`
      if (!seen.has(m)) {
        seen.add(m)
        warnings.push(m)
      }
    }
  }
  return warnings
}

/** The same warnings for the open workflow and every child workflow, each child's prefixed with its
 *  name (as the fixed button row warnings are). */
export function collectSyncPartnerWarningsWithChildren(
  parentNodes: WorkflowNode[],
  parentSpecId: string,
  allSpecs: Specification[],
): string[] {
  const sourcesOf = (specId: string): SourceMap | undefined => {
    const spec = allSpecs.find((s) => s.id === specId)
    return spec ? buildResourceSourceMap(spec, allSpecs) : undefined
  }
  const out = collectSyncPartnerWarnings(parentNodes, sourcesOf(parentSpecId))
  const walk = (specId: string) => {
    for (const child of allSpecs) {
      const data = child.data as { parentSpecificationId?: string; nodes?: WorkflowNode[] } | null
      if (data?.parentSpecificationId !== specId) continue
      for (const w of collectSyncPartnerWarnings(data.nodes ?? [], sourcesOf(child.id)))
        out.push(`${child.name} — ${w}`)
      walk(child.id)
    }
  }
  walk(parentSpecId)
  return out
}

/** Toast text for the warnings (same ' · ' separator as the other export warnings). */
export function formatSyncPartnerWarnings(warnings: string[]): string {
  return `Sync partners: ${warnings.join(' · ')}`
}
