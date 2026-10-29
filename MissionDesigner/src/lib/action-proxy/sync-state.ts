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

import type { Library, Specification } from '@/types/library'
import type { ParameterSpec, StepNodeData } from '@/types/nodes'
import { resolveActionSpecForNode } from './resolve-action-spec'
import {
  actionSignatureDiff,
  mergeActionSignature,
  type ParameterSignature,
  type SignatureDiff,
} from './signature-sync'

export type ActionSyncStatus = 'n/a' | 'unresolved' | 'synced' | 'outdated'

export interface ActionSyncState {
  status: ActionSyncStatus
  diff: SignatureDiff | null
  merged: { inputs: ParameterSpec[]; outputs: ParameterSpec[] } | null
  actionSpec?: Specification
}

const NA: ActionSyncState = Object.freeze({ status: 'n/a', diff: null, merged: null })
const UNRESOLVED: ActionSyncState = Object.freeze({ status: 'unresolved', diff: null, merged: null })

/** Spec 2026-09-04 §6.3 — pure: is this ACTION PROXY node's copied signature current? Shared by
 *  the per-node hook (badge, banner) and the header chip (workflow-wide). Never fetches. */
export function computeActionSyncState(
  nodeData: StepNodeData,
  workflowData: Record<string, unknown>,
  specById: Map<string, Specification>,
  libraries: Library[],
  specsByLibrary: Map<string, Specification[]>,
): ActionSyncState {
  // 'n/a' only when the node names no action at all — neither the explicit `actionName`
  // NOR a `label` to fall back on. Imported ACTION PROXY nodes (workflow-importers.ts)
  // never write actionName/actionLibraryName/environmentSpecId; they carry only `label`
  // (the step's local id), and resolveActionSpecForNode already falls back to
  // normalizeActionLabel(actionName || label) for exactly this case (final review #1).
  if (!nodeData.actionName && !nodeData.label) return NA
  const hit = resolveActionSpecForNode(workflowData, nodeData, specById, libraries, specsByLibrary)
  if (!hit) return UNRESOLVED
  const actionData = hit.actionSpec.data as ParameterSignature
  const diff = actionSignatureDiff(nodeData as ParameterSignature, actionData)
  if (!diff) return { status: 'synced', diff: null, merged: null, actionSpec: hit.actionSpec }
  return {
    status: 'outdated',
    diff,
    merged: mergeActionSignature(nodeData as ParameterSignature, actionData),
    actionSpec: hit.actionSpec,
  }
}

/** Index every loaded specification by id (all libraries). */
export function indexSpecsById(specifications: Map<string, Specification[]>): Map<string, Specification> {
  const byId = new Map<string, Specification>()
  for (const specs of specifications.values()) for (const s of specs) byId.set(s.id, s)
  return byId
}
