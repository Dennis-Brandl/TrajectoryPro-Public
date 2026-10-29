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

import { describe, it, expect } from 'vitest'
import {
  SPECIFICATION_STATES,
  legalTargets,
  rightForEdge,
  EDIT_LOCKED_STATES_DEFAULT,
  isEditLockedState,
  editLockedStateSet,
  categoryForEntityType,
} from '@/lib/lifecycle'

describe('lifecycle mirror', () => {
  it('enumerates all seven states in canonical order', () => {
    expect(SPECIFICATION_STATES).toEqual([
      'Draft',
      'InTest',
      'InReview',
      'Approved',
      'Effective',
      'Superseded',
      'Obsolete',
    ])
  })

  it('legalTargets matches the server LEGAL_EDGES table', () => {
    expect(legalTargets('Draft').sort()).toEqual(['Approved', 'InReview', 'InTest'])
    expect(legalTargets('InReview').sort()).toEqual(['Approved', 'Draft', 'InTest'])
    expect(legalTargets('Approved').sort()).toEqual(['Effective', 'Obsolete', 'Superseded'])
    expect(legalTargets('Effective').sort()).toEqual(['Obsolete', 'Superseded'])
    expect(legalTargets('Superseded')).toEqual(['Obsolete'])
    expect(legalTargets('Obsolete')).toEqual([]) // terminal
  })

  it('rightForEdge returns the verb each edge demands, or null when illegal', () => {
    expect(rightForEdge('Draft', 'InTest')).toBe('edit')
    expect(rightForEdge('InReview', 'Approved')).toBe('approve')
    expect(rightForEdge('Approved', 'Effective')).toBe('makeEffective')
    expect(rightForEdge('Effective', 'Approved')).toBeNull() // illegal (no reversal)
    expect(rightForEdge('Obsolete', 'Draft')).toBeNull()
  })

  it('edit-lock default + helpers', () => {
    expect([...EDIT_LOCKED_STATES_DEFAULT]).toEqual(['Approved', 'Effective', 'Superseded', 'Obsolete'])
    expect(isEditLockedState('Approved')).toBe(true)
    expect(isEditLockedState('Draft')).toBe(false)
    // honors a passed-in (admin-tuned) set
    expect(isEditLockedState('Draft', new Set(['Draft']))).toBe(true)
    expect(isEditLockedState('Approved', new Set(['Draft']))).toBe(false)
  })

  it('editLockedStateSet honors an explicit empty list (mirrors an admin who locks nothing) but defaults on nullish', () => {
    expect([...editLockedStateSet([])]).toEqual([]) // explicit empty → lock nothing
    expect(isEditLockedState('Approved', editLockedStateSet([]))).toBe(false)
    expect(editLockedStateSet(undefined).has('Approved')).toBe(true) // nullish → default
    expect(editLockedStateSet(null).has('Effective')).toBe(true)
  })

  it('categoryForEntityType folds step into workflow', () => {
    expect(categoryForEntityType('workflow')).toBe('workflow')
    expect(categoryForEntityType('step')).toBe('workflow')
    expect(categoryForEntityType('environment')).toBe('environment')
    expect(categoryForEntityType('action')).toBe('action')
  })
})
