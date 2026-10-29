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

import { pickLibraryByName } from '@/lib/global-team'
import type { Library, Specification } from '@/types/library'
import type { StepNodeData } from '@/types/nodes'

/**
 * Normalize a step/action label for matching. Strips a leading "Run " prefix (the
 * canonical convention for ACTION PROXY step names — "Run BakeItem") and collapses
 * whitespace to lowercase so "Run BakeItem", "bakeitem", and "Bake Item" all resolve
 * to the same key.
 */
export function normalizeActionLabel(s: string): string {
  return s
    .replace(/^run\s+/i, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

export interface ResolvedActionSpec {
  actionSpec: Specification
  envSpec: Specification
  libraryName: string
}

/**
 * Name-first resolution of an ACTION PROXY node's action spec (spec 2026-08-21 action-proxy
 * name binding; shared by the exporter, the sync-state hook and the header chip — spec
 * 2026-09-04 §6.1). Env candidate order: the node's own environmentSpecId, then the stored
 * config's environment_oid, then the workflow's remaining attached envs. First env whose
 * roster name-matches the node's action wins; `actionLibraryName`, when set, restricts the
 * match to that library. Returns undefined when nothing resolves.
 */
export function resolveActionSpecForNode(
  workflowData: Record<string, unknown>,
  nodeData: StepNodeData,
  specById: Map<string, Specification>,
  libraries: Library[],
  specsByLibrary: Map<string, Specification[]>,
): ResolvedActionSpec | undefined {
  const envSpecIds = workflowData.environmentSpecIds as string[] | undefined
  if (!envSpecIds || envSpecIds.length === 0) return undefined

  const explicitName = typeof nodeData.actionName === 'string' ? nodeData.actionName : ''
  const label = typeof nodeData.label === 'string' ? nodeData.label : ''
  const target = normalizeActionLabel(explicitName || label)
  if (!target) return undefined

  const preferred = typeof nodeData.environmentSpecId === 'string' ? nodeData.environmentSpecId : undefined
  const storedEnvOid =
    typeof nodeData.actionProxyConfig?.environment_oid === 'string'
      ? nodeData.actionProxyConfig.environment_oid
      : undefined
  const preferredIds = [preferred, storedEnvOid].filter((id): id is string => !!id && envSpecIds.includes(id))
  const ordered = [...new Set([...preferredIds, ...envSpecIds])]

  const requiredLib =
    typeof nodeData.actionLibraryName === 'string' && nodeData.actionLibraryName
      ? nodeData.actionLibraryName
      : undefined

  for (const envSpecId of ordered) {
    const envSpec = specById.get(envSpecId)
    if (!envSpec) continue
    const envData = envSpec.data as Record<string, unknown>
    const includedActions = (envData.included_actions ?? envData.includedActions) as
      | Array<{ action_name?: string; actionName?: string; action_library?: string; actionLibrary?: string }>
      | undefined
    if (!includedActions) continue
    for (const ia of includedActions) {
      const actionName = ia.action_name ?? ia.actionName
      if (!actionName || normalizeActionLabel(actionName) !== target) continue
      const libName = ia.action_library ?? ia.actionLibrary
      if (!libName) continue
      if (requiredLib && libName !== requiredLib) continue
      const envTeamId = libraries.find((l) => l.id === envSpec.libraryId)?.teamId
      const lib = pickLibraryByName(libraries, libName, 'action', envTeamId)
      if (!lib) continue
      const actionSpec = (specsByLibrary.get(lib.id) ?? []).find((s) => s.name === actionName)
      if (!actionSpec) continue
      return { actionSpec, envSpec, libraryName: libName }
    }
  }
  return undefined
}
