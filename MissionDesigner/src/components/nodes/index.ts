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
import type { NodeTypes } from '@xyflow/react'
import { useNotationStore } from '@/stores/notationStore'
import { flowchartNodeTypes } from './renderers/flowchart'
import { bpmnNodeTypes } from './renderers/bpmn'
import { isa88NodeTypes } from './renderers/isa88'
import type { Notation } from '@/types/notation'

/**
 * CRITICAL: Define at module scope to prevent re-renders.
 * React Flow remounts all nodes if nodeTypes object reference changes.
 */
const nodeTypesByNotation: Record<Notation, NodeTypes> = {
  flowchart: flowchartNodeTypes,
  bpmn: bpmnNodeTypes,
  isa88: isa88NodeTypes,
}

/**
 * Hook to get the current notation's nodeTypes.
 * Uses useMemo to maintain referential stability.
 *
 * Usage:
 * ```tsx
 * function FlowCanvas() {
 *   const nodeTypes = useNodeTypes();
 *   return <ReactFlow nodeTypes={nodeTypes} ... />;
 * }
 * ```
 */
export function useNodeTypes(): NodeTypes {
  const notation = useNotationStore((s) => s.notation)
  return useMemo(() => nodeTypesByNotation[notation], [notation])
}
