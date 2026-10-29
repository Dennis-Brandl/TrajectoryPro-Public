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
import { findSpecWithStep, orderSteps, whereItems } from '../where'
import { ROOT, liveStep } from './where-fixtures'

describe('orderSteps', () => {
  it('walks from START along the connections, then lists unreached steps top-down, without START/END', () => {
    expect(orderSteps(ROOT).map((s) => s.name)).toEqual(['Weigh', 'Charge', 'Heat', 'Side note'])
  })
})

describe('findSpecWithStep', () => {
  it('finds the (sub-)workflow that holds the step; null for an unknown step', () => {
    expect(findSpecWithStep(ROOT, 'c1')!.oid).toBe('child')
    expect(findSpecWithStep(ROOT, 'charge')!.oid).toBe('root')
    expect(findSpecWithStep(ROOT, 'nope')).toBeNull()
  })
})

describe('whereItems', () => {
  it('marks done, current, not started and problem steps, in walk order', () => {
    const items = whereItems(
      ROOT,
      { weigh: liveStep('COMPLETED'), charge: liveStep('WAITING_USER'), note: liveStep('ERRORED') },
      'charge',
    )
    expect(items.map((i) => [i.name, i.kind, i.stateText])).toEqual([
      ['Weigh', 'done', 'Completed'],
      ['Charge', 'current', 'Waiting for operator'],
      ['Heat', 'todo', 'Not started'],
      ['Side note', 'problem', 'Errored'],
    ])
    expect(items.filter((i) => i.current).map((i) => i.oid)).toEqual(['charge'])
  })

  it('a step inside a sub-workflow lists that sub-workflow; an unknown step lists the root with no current step', () => {
    expect(whereItems(ROOT, {}, 'c1').map((i) => [i.name, i.kind])).toEqual([['Inner', 'current']])
    expect(whereItems(ROOT, {}, 'nope').some((i) => i.current)).toBe(false)
  })
})
