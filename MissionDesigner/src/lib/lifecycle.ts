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

// Client-side mirror of the server lifecycle state machine + rights category
// map (design §6/§7). The SERVER (src/server/authz/policy.ts + rights.ts) is
// authoritative and re-checks every write; these tables exist only to drive UI
// affordances (legal-transition lists, edit-lock greying). Keep in lockstep
// with policy.ts LEGAL_EDGES / rights.ts cat() / EDIT_LOCKED_STATES_DEFAULT.

import type { SpecificationState } from '@/types/library'

export const SPECIFICATION_STATES: readonly SpecificationState[] = [
  'Draft',
  'InTest',
  'InReview',
  'Approved',
  'Effective',
  'Superseded',
  'Obsolete',
] as const

type EdgeVerb = 'edit' | 'approve' | 'makeEffective'

/** `${from}>${to}` → the right verb the edge demands. Mirrors policy.ts LEGAL_EDGES. */
const LEGAL_EDGES: Readonly<Record<string, EdgeVerb>> = {
  'Draft>InTest': 'edit',
  'Draft>InReview': 'edit',
  'InTest>Draft': 'edit',
  'InTest>InReview': 'edit',
  'InReview>Draft': 'edit',
  'InReview>InTest': 'edit',
  'Draft>Approved': 'approve',
  'InTest>Approved': 'approve',
  'InReview>Approved': 'approve',
  'Approved>Effective': 'makeEffective',
  'Approved>Superseded': 'makeEffective',
  'Approved>Obsolete': 'makeEffective',
  'Effective>Superseded': 'makeEffective',
  'Effective>Obsolete': 'makeEffective',
  'Superseded>Obsolete': 'makeEffective',
}

/** The states legally reachable from `from` (non-admin). Empty for terminal Obsolete. */
export function legalTargets(from: string): SpecificationState[] {
  return SPECIFICATION_STATES.filter((to) => `${from}>${to}` in LEGAL_EDGES)
}

/** The right verb an edge demands, or null for an illegal edge. */
export function rightForEdge(from: string, to: string): EdgeVerb | null {
  return LEGAL_EDGES[`${from}>${to}`] ?? null
}

/** Spec states whose content is edit-locked by default (admin-tunable server-side). */
export const EDIT_LOCKED_STATES_DEFAULT: readonly SpecificationState[] = [
  'Approved',
  'Effective',
  'Superseded',
  'Obsolete',
] as const

/** Build a lookup set from a live edit-lock list, falling back to the default. */
export function editLockedStateSet(list?: readonly string[] | null): Set<string> {
  return new Set(list ?? EDIT_LOCKED_STATES_DEFAULT)
}

/** Whether `state` is edit-locked. `locked` defaults to the seeded default set. */
export function isEditLockedState(state: string, locked: Set<string> = editLockedStateSet()): boolean {
  return locked.has(state)
}

export type RightsCategory = 'workflow' | 'environment' | 'action'

/** Maps an entityType to its rights category (step folds into workflow). Mirrors rights.ts cat(). */
export function categoryForEntityType(entityType: string): RightsCategory {
  switch (entityType) {
    case 'workflow':
    case 'step':
      return 'workflow'
    case 'environment':
      return 'environment'
    case 'action':
      return 'action'
    default:
      return 'workflow'
  }
}
