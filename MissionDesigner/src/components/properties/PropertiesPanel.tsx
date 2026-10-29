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

import { memo, useMemo } from 'react'
import { useReactFlow } from '@xyflow/react'
import type { Edge } from '@xyflow/react'
import { useShallow } from 'zustand/react/shallow'
import { PanelRight } from 'lucide-react'
import { useFlowStore } from '@/stores/flowStore'
import { useLibraryStore } from '@/stores/libraryStore'
import { useSpecificationStore } from '@/stores/specificationStore'
import { useNotationStore } from '@/stores/notationStore'
import { useSpecificationById } from '@/hooks/useSpecificationById'
import { useCanEditActiveSpec } from '@/hooks/useCanEditActiveSpec'
import { EdgeConditionEditor } from './EdgeConditionEditor'
import { NodeInlineEditor } from './NodeInlineEditor'
import { WorkflowInlineEditor } from './WorkflowInlineEditor'
import type { WorkflowNode, NodeType, ParameterSpec, ResourceSpec, ValueSpec } from '@/types/nodes'
import type { ConditionalEdgeData } from '@/types/edges'
import type { Notation } from '@/types/notation'

function getTypeLabel(nodeType: NodeType, notation?: Notation): string {
  switch (nodeType) {
    case 'workflowProxy':
      return 'Child Workflow'
    case 'actionProxyWait':
      return 'Environment Action'
    case 'yesNoStep':
      return 'Yes/No Step'
    case 'userInteractionStep':
      return 'User Interaction Step'
    case 'scriptStep':
      return 'Script Step'
    case 'select1':
      return 'Select 1'
    case 'gateStep':
      return notation === 'isa88' ? 'Transition Step' : 'Gate Step'
    default:
      return nodeType.replace(/([A-Z])/g, ' $1').trim()
  }
}

interface PropertiesPanelProps {
  onCollapse: () => void
}

function PropertiesPanelComponent({ onCollapse }: PropertiesPanelProps) {
  const { storeNodes, storeEdges } = useFlowStore(
    useShallow((state) => ({
      storeNodes: state.nodes,
      storeEdges: state.edges,
    })),
  )
  const { getNode } = useReactFlow()
  const canEdit = useCanEditActiveSpec()
  const notation = useNotationStore((s) => s.notation)

  // Library store
  const selectedSpecificationId = useLibraryStore((state) => state.selectedSpecificationId)
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId)
  const specifications = useLibraryStore((state) => state.specifications)

  // Get current workflow specification name
  const currentSpecification = useMemo(() => {
    if (!selectedSpecificationId || !selectedLibraryId) return null
    const libSpecs = specifications.get(selectedLibraryId)
    return libSpecs?.find((s) => s.id === selectedSpecificationId) || null
  }, [selectedSpecificationId, selectedLibraryId, specifications])

  // Derive selection from canvas
  const selectedNodes = useMemo(() => storeNodes.filter((n) => n.selected), [storeNodes])
  const selectedEdges = useMemo(() => storeEdges.filter((e) => e.selected) as Edge<ConditionalEdgeData>[], [storeEdges])

  const totalSelected = selectedNodes.length + selectedEdges.length

  // The selected node (direct from canvas — no displayedNodeId guard needed)
  const selectedNode = selectedNodes.length === 1 ? selectedNodes[0] : null
  const selectedNodeId = selectedNode?.id ?? null
  const selectedNodeType = selectedNode?.type as NodeType | undefined
  const selectedNodeData = selectedNode?.data

  // Get sub-workflow specification properties based on selected node. Only
  // these three fields matter, so they (not the whole data object) drive the memo.
  const subWorkflowMode = selectedNodeData?.subWorkflowMode
  const embeddedWorkflowSpecId = selectedNodeData?.embeddedWorkflowSpecId
  const referencedStepSpecId = selectedNodeData?.referencedStepSpecId
  const subWorkflowSpecId = useMemo(() => {
    if (selectedNodeType !== 'workflowProxy') return null
    if (subWorkflowMode === 'embedded') return embeddedWorkflowSpecId ?? null
    if (subWorkflowMode === 'reference') return referencedStepSpecId ?? null
    return null
  }, [selectedNodeType, subWorkflowMode, embeddedWorkflowSpecId, referencedStepSpecId])

  const { spec: subWorkflowSpec } = useSpecificationById(subWorkflowSpecId)

  // Also check specificationStore for embedded child workflows (not in libraryStore)
  const specStoreSpecs = useSpecificationStore((s) => s.specs)
  const childSpec = useMemo(() => {
    if (subWorkflowSpec || !subWorkflowSpecId) return null
    return specStoreSpecs.get(subWorkflowSpecId) ?? null
  }, [subWorkflowSpec, subWorkflowSpecId, specStoreSpecs])

  const subWorkflowProps = useMemo(() => {
    const specData = (subWorkflowSpec?.data ?? childSpec?.data) as
      | {
          workflowInputs?: ParameterSpec[]
          workflowOutputs?: ParameterSpec[]
          workflowValues?: ValueSpec[]
          workflowResources?: ResourceSpec[]
        }
      | undefined
    if (!specData) {
      // New empty child — return empty editable props so childDraft is initialized
      if (subWorkflowSpecId) return { inputs: [], outputs: [], values: [], resources: [] }
      return null
    }
    return {
      inputs: specData?.workflowInputs || [],
      outputs: specData?.workflowOutputs || [],
      values: specData?.workflowValues || [],
      resources: specData?.workflowResources || [],
    }
  }, [subWorkflowSpec, childSpec, subWorkflowSpecId])

  // Sub-workflow mode flags
  const isEmbeddedSubWorkflow = selectedNodeType === 'workflowProxy' && selectedNodeData?.subWorkflowMode === 'embedded'
  const isReferencedSubWorkflow =
    selectedNodeType === 'workflowProxy' && selectedNodeData?.subWorkflowMode === 'reference'

  // Compute dynamic header label and name
  let headerLabel: string
  let headerName: string

  if (selectedNodeId !== null && selectedNode && selectedNodeType) {
    // Node view
    headerLabel = getTypeLabel(selectedNodeType, notation)
    headerName = selectedNodeData?.label || ''
  } else if (totalSelected > 1) {
    headerLabel = ''
    headerName = `${totalSelected} items selected`
  } else if (selectedEdges.length === 1 && selectedNodes.length === 0) {
    const edge = selectedEdges[0]
    const sourceNode = getNode(edge.source) as WorkflowNode | undefined
    headerLabel = 'Connection'
    headerName = sourceNode?.data.label || 'Unknown'
  } else {
    headerLabel = 'Workflow Properties'
    headerName = currentSpecification?.name || 'Untitled'
  }

  return (
    <>
      {/* Sticky panel header with dynamic title and collapse button */}
      <div className="sticky top-0 z-20 bg-white dark:bg-slate-900 h-12 border-b border-slate-200 dark:border-slate-700 flex items-center px-4 shrink-0 justify-between">
        <div className="flex items-center min-w-0 flex-1">
          <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide shrink-0">
            {headerLabel}
          </span>
          {headerName && (
            <span className="font-medium text-slate-700 dark:text-slate-200 ml-2 truncate text-sm">{headerName}</span>
          )}
        </div>
        <button
          onClick={onCollapse}
          title="Hide Properties Panel"
          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 shrink-0 ml-2"
        >
          <PanelRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <fieldset disabled={!canEdit} className="contents">
        {/* Panel content based on selection state */}

        {/* Workflow properties — shown when nothing is selected */}
        {totalSelected === 0 && <WorkflowInlineEditor />}

        {/* Multiple selection message */}
        {totalSelected > 1 && (
          <div className="p-3 text-center">
            <p className="text-slate-500 text-sm">{totalSelected} items selected</p>
            <p className="text-xs text-slate-500">Select a single item to edit properties</p>
          </div>
        )}

        {/* Edge condition editor — shown when a single edge is selected */}
        {totalSelected === 1 &&
          selectedEdges.length === 1 &&
          selectedNodes.length === 0 &&
          (() => {
            const edge = selectedEdges[0]
            const sourceNode = getNode(edge.source) as WorkflowNode | undefined
            const isFromSelect1 = sourceNode?.type === 'select1'

            return (
              <div className="p-3 space-y-3">
                {isFromSelect1 ? (
                  <EdgeConditionEditor
                    sourceNodeData={sourceNode.data}
                    sourceHandleId={edge.sourceHandle}
                    sourceNodeLabel={sourceNode.data.label || 'SELECT'}
                  />
                ) : (
                  <p className="text-xs text-slate-500 italic">
                    Condition expressions are only available for connections from SELECT 1 nodes.
                  </p>
                )}
              </div>
            )
          })()}

        {/* Node inline editor — shown when a single node is selected */}
        {selectedNodeId !== null && selectedNode && selectedNodeData && selectedNodeType && (
          <NodeInlineEditor
            nodeId={selectedNode.id}
            nodeType={selectedNodeType}
            initialData={selectedNodeData}
            initialChildData={subWorkflowProps}
            isEmbeddedSubWorkflow={isEmbeddedSubWorkflow}
            isReferencedSubWorkflow={isReferencedSubWorkflow}
          />
        )}
      </fieldset>
    </>
  )
}

export const PropertiesPanel = memo(PropertiesPanelComponent)
