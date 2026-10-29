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

import { useMemo } from 'react'
import { useLibraryStore } from '@/stores/libraryStore'
import type { StepNodeData } from '@/types/nodes'
import { computeActionSyncState, indexSpecsById, type ActionSyncState } from '@/lib/action-proxy/sync-state'

export type { ActionSyncState, ActionSyncStatus } from '@/lib/action-proxy/sync-state'

const NA: ActionSyncState = Object.freeze({ status: 'n/a', diff: null, merged: null })

/**
 * Spec 2026-09-04 §6.3: sync status of one ACTION PROXY node against its resolved action spec.
 * Reads the library store only (the ActionSelector's own reads); never fetches — the header's
 * OutdatedActionsChip triggers action-library loads so badges appear without opening the panel.
 *
 * `enabled` (default true) lets a caller that renders every node type — e.g.
 * NodeInlineEditor, which has no node-type field on StepNodeData to gate on — skip the
 * resolver entirely for non-ACTION-PROXY nodes. The store selectors stay unconditional (hooks
 * must run in the same order every render); only the resolver work inside the memo is skipped.
 */
export function useActionProxySyncState(nodeData: StepNodeData, enabled = true): ActionSyncState {
  const libraries = useLibraryStore((s) => s.libraries)
  const specifications = useLibraryStore((s) => s.specifications)
  const selectedSpecificationId = useLibraryStore((s) => s.selectedSpecificationId)
  const { inputs, outputs, actionName, actionLibraryName, environmentSpecId, actionProxyConfig, label } = nodeData

  return useMemo(() => {
    if (!enabled) return NA
    const specById = indexSpecsById(specifications)
    const current = selectedSpecificationId ? specById.get(selectedSpecificationId) : undefined
    const workflowData = (current?.data ?? {}) as Record<string, unknown>
    return computeActionSyncState(
      { ...nodeData, inputs, outputs, actionName, actionLibraryName, environmentSpecId, actionProxyConfig, label },
      workflowData,
      specById,
      libraries,
      specifications,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    inputs,
    outputs,
    actionName,
    actionLibraryName,
    environmentSpecId,
    actionProxyConfig,
    label,
    libraries,
    specifications,
    selectedSpecificationId,
  ])
}
