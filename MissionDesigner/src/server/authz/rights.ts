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

// Central rights catalog + seeded role bundles. Pure data — NO db imports.
// Consumed by `seedRoles` (test fixtures / explicit re-seed) and the authorization engine.

export type RightsCategory = 'workflow' | 'environment' | 'action'

/** Maps a library/spec entityType to its rights category (step folds into workflow). */
export function cat(entityType: string): RightsCategory {
  switch (entityType) {
    case 'workflow':
    case 'step':
      return 'workflow'
    case 'environment':
      return 'environment'
    case 'action':
      return 'action'
    default:
      throw new Error(`unknown entityType: ${entityType}`)
  }
}

export const RIGHTS_CATEGORIES: readonly RightsCategory[] = ['workflow', 'environment', 'action'] as const

const OBJECT_VERBS = ['create', 'edit', 'delete', 'approve', 'makeEffective'] as const
const LIBRARY_VERBS = ['library.create', 'library.delete'] as const
const AUTHOR_VERBS = ['create', 'edit', 'delete'] as const

/** All 21 rights as `${category}:${verb}`. */
export const RIGHTS: readonly string[] = RIGHTS_CATEGORIES.flatMap((c) => [
  ...OBJECT_VERBS.map((v) => `${c}:${v}`),
  ...LIBRARY_VERBS.map((v) => `${c}:${v}`),
])

/** Spec states in which content editing/deletion is locked by default (admin-tunable). */
export const EDIT_LOCKED_STATES_DEFAULT: readonly string[] = ['Approved', 'Effective', 'Superseded', 'Obsolete']

export interface RoleSeed {
  id: string
  name: string
  description: string
  rights: string[]
}

function rightsFor(cats: readonly RightsCategory[], verbs: readonly string[]): string[] {
  return cats.flatMap((c) => verbs.map((v) => `${c}:${v}`))
}

const CAP: Record<RightsCategory, string> = { workflow: 'Workflow', environment: 'Environment', action: 'Action' }

/** 16 seeded roles: 4 cross-category + 4 per each of the 3 categories. */
export const ROLE_SEEDS: readonly RoleSeed[] = [
  {
    id: 'role-author',
    name: 'Author',
    description: 'Create, edit, and delete objects (all types)',
    rights: rightsFor(RIGHTS_CATEGORIES, AUTHOR_VERBS),
  },
  {
    id: 'role-approver',
    name: 'Approver',
    description: 'Approve objects for use (all types)',
    rights: rightsFor(RIGHTS_CATEGORIES, ['approve']),
  },
  {
    id: 'role-publisher',
    name: 'Publisher',
    description: 'Make objects effective / supersede / obsolete (all types)',
    rights: rightsFor(RIGHTS_CATEGORIES, ['makeEffective']),
  },
  {
    id: 'role-librarian',
    name: 'Librarian',
    description: 'Create and delete libraries (all types)',
    rights: rightsFor(RIGHTS_CATEGORIES, LIBRARY_VERBS),
  },
  ...RIGHTS_CATEGORIES.flatMap((c): RoleSeed[] => [
    {
      id: `role-${c}-author`,
      name: `${CAP[c]} Author`,
      description: `Create, edit, and delete ${c} objects`,
      rights: rightsFor([c], AUTHOR_VERBS),
    },
    {
      id: `role-${c}-approver`,
      name: `${CAP[c]} Approver`,
      description: `Approve ${c} objects for use`,
      rights: rightsFor([c], ['approve']),
    },
    {
      id: `role-${c}-publisher`,
      name: `${CAP[c]} Publisher`,
      description: `Make ${c} objects effective`,
      rights: rightsFor([c], ['makeEffective']),
    },
    {
      id: `role-${c}-librarian`,
      name: `${CAP[c]} Librarian`,
      description: `Create and delete ${c} libraries`,
      rights: rightsFor([c], LIBRARY_VERBS),
    },
  ]),
]
