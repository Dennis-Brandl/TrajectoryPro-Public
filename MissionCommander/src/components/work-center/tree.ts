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
import type { WcNode } from '@/lib/api/types';
export type TreeNode = WcNode & { children: TreeNode[] };
export function buildForest(nodes: WcNode[]): TreeNode[] {
  const byId = new Map<string, TreeNode>(nodes.map((n) => [n.id, { ...n, children: [] }]));
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentWorkCenterId ? byId.get(node.parentWorkCenterId) : null;
    (parent ? parent.children : roots).push(node);
  }
  const sort = (list: TreeNode[]) => { list.sort((a, b) => a.name.localeCompare(b.name)); list.forEach((n) => sort(n.children)); };
  sort(roots);
  return roots;
}
