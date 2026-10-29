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
import { useFlowStore } from '@/stores/flowStore'
import type { WorkflowNode, ParameterSpec, ValueSpec, ResourceSpec, TrySpec } from '@/types/nodes'
import type { Edge } from '@xyflow/react'

/**
 * Reset the flow store to a clean state and clear undo/redo history.
 */
export function resetFlowStore() {
  useFlowStore.setState({
    nodes: [],
    edges: [],
    workflowInputs: [],
    workflowOutputs: [],
    workflowValues: [],
    workflowResources: [],
    workflowTrySpecifications: [],
    draftAt: null,
    hasDraft: false,
    editDialogRequest: null,
    _showLegacyUpgradeNotice: false,
    propertiesPanelWidth: 280,
  })
  useFlowStore.temporal.getState().clear()
}

/**
 * Seed the flow store with nodes, edges, and optional workflow-level properties.
 * Clears temporal history after seeding so tests start with clean undo state.
 */
export function seedFlowStore(opts: {
  nodes?: WorkflowNode[]
  edges?: Edge[]
  workflowInputs?: ParameterSpec[]
  workflowOutputs?: ParameterSpec[]
  workflowValues?: ValueSpec[]
  workflowResources?: ResourceSpec[]
  workflowTrySpecifications?: TrySpec[]
}) {
  useFlowStore.setState({
    nodes: opts.nodes ?? [],
    edges: opts.edges ?? [],
    workflowInputs: opts.workflowInputs ?? [],
    workflowOutputs: opts.workflowOutputs ?? [],
    workflowValues: opts.workflowValues ?? [],
    workflowResources: opts.workflowResources ?? [],
    workflowTrySpecifications: opts.workflowTrySpecifications ?? [],
  })
  useFlowStore.temporal.getState().clear()
}
