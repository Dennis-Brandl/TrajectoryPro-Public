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

import { useEffect, useMemo } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@mission/ui'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'
import { useFlowStore } from '@/stores/flowStore'
import { useLibraryStore } from '@/stores/libraryStore'
import { useCanEditActiveSpec } from '@/hooks/useCanEditActiveSpec'
import { computeActionSyncState, indexSpecsById } from '@/lib/action-proxy/sync-state'
import type { ParameterSpec, StepNodeData } from '@/types/nodes'

/**
 * Spec 2026-09-04 §6.4.3: workflow-wide signature sync. Counts the ACTION PROXY steps whose
 * copied inputs/outputs no longer match their action, and "Update all" writes every merged
 * signature through one bulk flow-store update (which bumps nodeDataRevision so an open panel
 * re-seeds). Also loads any action library not yet in the store, so canvas badges resolve
 * without the properties panel ever opening (the ActionSelector precedent).
 */
export function OutdatedActionsChip() {
  const updateNodesData = useFlowStore((s) => s.updateNodesData)
  const libraries = useLibraryStore((s) => s.libraries)
  const specifications = useLibraryStore((s) => s.specifications)
  const selectedSpecificationId = useLibraryStore((s) => s.selectedSpecificationId)
  const fetchSpecifications = useLibraryStore((s) => s.fetchSpecifications)
  const canEdit = useCanEditActiveSpec()

  useEffect(() => {
    for (const lib of libraries) {
      if (lib.entityType === 'action' && !specifications.has(lib.id)) fetchSpecifications(lib.id)
    }
  }, [libraries, specifications, fetchSpecifications])

  // React Flow's applyNodeChanges (onNodesChange) replaces the `nodes` array — and every node
  // wrapper in it — on every drag frame, position/selection/measurement change; it keeps each
  // node's `data` reference stable. Selecting these two shallow-stable arrays (rather than
  // `nodes` itself) means the memo below does not rebuild — and does not rescan every
  // ACTION PROXY node's resolver + structuredClone — on a drag frame (final review #3).
  const proxyIds = useFlowStore(useShallow((s) => s.nodes.filter((n) => n.type === 'actionProxyWait').map((n) => n.id)))
  const proxyData = useFlowStore(
    useShallow((s) => s.nodes.filter((n) => n.type === 'actionProxyWait').map((n) => n.data as StepNodeData)),
  )

  const specById = useMemo(() => indexSpecsById(specifications), [specifications])

  const outdated = useMemo(() => {
    const current = selectedSpecificationId ? specById.get(selectedSpecificationId) : undefined
    const workflowData = (current?.data ?? {}) as Record<string, unknown>
    const result: Array<{ id: string; merged: { inputs: ParameterSpec[]; outputs: ParameterSpec[] } }> = []
    for (let i = 0; i < proxyIds.length; i++) {
      const state = computeActionSyncState(proxyData[i], workflowData, specById, libraries, specifications)
      if (state.status === 'outdated' && state.merged) result.push({ id: proxyIds[i], merged: state.merged })
    }
    return result
    // specifications is omitted: specById is a fresh Map recomputed from it above, so its
    // identity already changes whenever specifications does — the closure below always reads
    // the current specifications for the same render in which specById changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proxyIds, proxyData, specById, libraries, selectedSpecificationId])

  if (outdated.length === 0) return null
  const n = outdated.length
  const noun = n === 1 ? 'step' : 'steps'

  return (
    <div
      className="flex items-center gap-2 px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 rounded text-xs"
      data-testid="outdated-actions-chip"
    >
      <AlertTriangle className="h-3 w-3" />
      <span>
        {n} {noun} with outdated action definitions
      </span>
      <Button
        variant="outline"
        size="sm"
        className="h-6 px-2 text-xs"
        data-testid="action-sync-update-all"
        disabled={!canEdit}
        onClick={() => {
          updateNodesData(
            outdated.map((o) => ({ id: o.id, data: { inputs: o.merged.inputs, outputs: o.merged.outputs } })),
          )
          toast.success(`Updated ${n} ${noun} from their actions`)
        }}
      >
        Update all
      </Button>
    </div>
  )
}
