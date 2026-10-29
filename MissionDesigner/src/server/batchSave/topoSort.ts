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

// Phase 35 §2.4 step 5: Kahn's algorithm topological sort over spec creates.
// Parents not present in the input set are treated as pre-existing (no edge
// added) — they will be resolved against the DB in phase 1 step 6.

export interface TopoInput {
  id: string
  parentSpecificationId: string | null | undefined
}

export class TopoCycleError extends Error {
  constructor(public cycleIds: string[]) {
    super(`cycle detected: ${cycleIds.join(' → ')}`)
    this.name = 'TopoCycleError'
  }
}

export function topoSortCreates(items: TopoInput[]): string[] {
  const idSet = new Set(items.map((i) => i.id))
  const indeg = new Map<string, number>()
  const children = new Map<string, string[]>()
  for (const i of items) indeg.set(i.id, 0)
  for (const i of items) {
    const p = i.parentSpecificationId
    if (p && idSet.has(p)) {
      indeg.set(i.id, (indeg.get(i.id) ?? 0) + 1)
      const list = children.get(p) ?? []
      list.push(i.id)
      children.set(p, list)
    }
  }
  const queue: string[] = []
  for (const [id, d] of indeg.entries()) if (d === 0) queue.push(id)
  const out: string[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    out.push(id)
    for (const child of children.get(id) ?? []) {
      const d = (indeg.get(child) ?? 0) - 1
      indeg.set(child, d)
      if (d === 0) queue.push(child)
    }
  }
  if (out.length !== items.length) {
    const remaining = items.filter((i) => !out.includes(i.id)).map((i) => i.id)
    throw new TopoCycleError(remaining)
  }
  return out
}
