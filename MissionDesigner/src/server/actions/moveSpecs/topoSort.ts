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

/** BFS topological sort: guarantees every parent is emitted before its children,
 *  regardless of the order the recursive CTE hands back rows. */
export function topoSortByParent<T extends { id: string; parentSpecificationId: string | null }>(rows: T[]): T[] {
  const byParent = new Map<string | null, T[]>()
  for (const r of rows) {
    const arr = byParent.get(r.parentSpecificationId) ?? []
    arr.push(r)
    byParent.set(r.parentSpecificationId, arr)
  }
  const result: T[] = []
  const queue: T[] = [...(byParent.get(null) ?? [])]
  while (queue.length > 0) {
    const node = queue.shift()!
    result.push(node)
    const children = byParent.get(node.id) ?? []
    queue.push(...children)
  }
  // Append any orphans / cycles so the INSERT throws a clear FK error rather
  // than silently dropping rows.
  if (result.length < rows.length) {
    const seen = new Set(result.map((r) => r.id))
    for (const r of rows) if (!seen.has(r.id)) result.push(r)
  }
  return result
}
