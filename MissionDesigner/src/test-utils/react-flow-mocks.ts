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
/**
 * Mock helpers for @xyflow/react in component tests.
 *
 * Usage in test files:
 *   vi.mock('@xyflow/react', () => reactFlowMocks)
 */
export const Position = {
  Top: 'top',
  Bottom: 'bottom',
  Left: 'left',
  Right: 'right',
} as const

export const reactFlowMocks = {
  Position,
  Handle: (_props: { type: string; position: string; id?: string }) => null,
  useConnection: () => ({ inProgress: false, fromNode: null, fromHandle: null }),
  useReactFlow: () => ({
    getNodes: () => [],
    getEdges: () => [],
    setNodes: () => {},
    setEdges: () => {},
    fitView: () => {},
    project: (pos: { x: number; y: number }) => pos,
  }),
  ReactFlow: ({ children }: { children?: React.ReactNode }) => children,
  ReactFlowProvider: ({ children }: { children?: React.ReactNode }) => children,
  useNodesState: (initial: unknown[]) => [initial, () => {}, () => {}],
  useEdgesState: (initial: unknown[]) => [initial, () => {}, () => {}],
  MarkerType: { Arrow: 'arrow', ArrowClosed: 'arrowclosed' },
  useUpdateNodeInternals: () => () => {},
}
