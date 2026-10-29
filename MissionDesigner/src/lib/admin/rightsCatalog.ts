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

// UI metadata for the rights grid. The right ids composed here MUST stay in
// lockstep with the server catalog (src/server/authz/rights.ts — pure data,
// safe to bundle); the adminClient test asserts the two sets are identical.

import { RIGHTS_CATEGORIES, type RightsCategory } from '../../server/authz/rights'

export { RIGHTS_CATEGORIES }
export type { RightsCategory }

export const CATEGORY_LABELS: Record<RightsCategory, string> = {
  workflow: 'Workflow (+ Steps)',
  environment: 'Environment',
  action: 'Action',
}

export const RIGHT_VERBS = [
  { verb: 'create', label: 'Create' },
  { verb: 'edit', label: 'Edit' },
  { verb: 'delete', label: 'Delete' },
  { verb: 'approve', label: 'Approve' },
  { verb: 'makeEffective', label: 'Make Effective' },
  { verb: 'library.create', label: 'Create Libraries' },
  { verb: 'library.delete', label: 'Delete Libraries' },
] as const

export function rightId(category: RightsCategory, verb: string): string {
  return `${category}:${verb}`
}

/** "workflow: create, edit · action: edit" — category-grouped summary for list rows. */
export function summarizeRights(rights: string[]): string {
  const byCat = new Map<string, string[]>()
  for (const r of rights) {
    const [cat, verb] = r.split(':')
    const list = byCat.get(cat) ?? []
    list.push(verb)
    byCat.set(cat, list)
  }
  return RIGHTS_CATEGORIES.filter((c) => byCat.has(c))
    .map((c) => `${c}: ${byCat.get(c)!.join(', ')}`) // filter above guarantees presence
    .join(' · ')
}
