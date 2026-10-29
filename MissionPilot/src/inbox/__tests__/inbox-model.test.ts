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
import { formatAge, matchesFilter, waitingSince } from '../inbox-model'
import type { InboxTask } from '../../api/types'

function task(overrides: Partial<InboxTask> = {}): InboxTask {
  return {
    assignmentId: 'a1', stepInstanceId: 'si1', stepOid: 'so1', stepType: 'form', stepName: 'Charge Kettle',
    instanceId: 'i1', runtimeNumber: 2, runtimeLabel: 'MIX-20261009-0002', masterName: 'Batch Mix',
    masterVersion: '3', workflowPath: ['Charge sub-flow'], stepUpdatedAt: '2026-10-10T11:00:00.000Z',
    offeredAt: '2026-10-10T10:00:00.000Z', claimedAt: null, suggestedForMe: false, paused: false,
    formDocument: null, yesNoConfig: null, ...overrides,
  }
}

describe('matchesFilter (spec §5.5: step, workflow or runtime ID)', () => {
  it('matches step, workflow, child workflow and runtime ID, ignoring case and surrounding spaces', () => {
    expect(matchesFilter(task(), 'kettle')).toBe(true)
    expect(matchesFilter(task(), '  BATCH mix ')).toBe(true)
    expect(matchesFilter(task(), 'sub-flow')).toBe(true)
    expect(matchesFilter(task(), '0002')).toBe(true)
    expect(matchesFilter(task(), 'weigh')).toBe(false)
  })

  it('an empty or blank filter matches everything; a nameless step matches on its oid', () => {
    expect(matchesFilter(task(), '')).toBe(true)
    expect(matchesFilter(task(), '   ')).toBe(true)
    expect(matchesFilter(task({ stepName: null, stepOid: 'step-42' }), 'step-42')).toBe(true)
  })
})

describe('formatAge (Review Focus 3)', () => {
  const now = Date.parse('2026-10-10T12:00:00.000Z')

  it('says how long in words', () => {
    expect(formatAge('2026-10-10T11:59:30.000Z', now)).toBe('just now')
    expect(formatAge('2026-10-10T11:55:00.000Z', now)).toBe('5 min')
    expect(formatAge('2026-10-10T11:00:01.000Z', now)).toBe('59 min')
    expect(formatAge('2026-10-10T10:00:00.000Z', now)).toBe('2 h')
    expect(formatAge('2026-10-07T12:00:00.000Z', now)).toBe('3 d')
  })

  it('a future time (clock skew) is "just now" and garbage is blank — never negative or NaN', () => {
    expect(formatAge('2026-10-10T12:05:00.000Z', now)).toBe('just now')
    expect(formatAge('not a date', now)).toBe('')
  })
})

describe('waitingSince', () => {
  it('is the step\'s last change, else when it was offered (a cached pre-P1b snapshot)', () => {
    expect(waitingSince(task())).toBe('2026-10-10T11:00:00.000Z')
    expect(waitingSince(task({ stepUpdatedAt: undefined }))).toBe('2026-10-10T10:00:00.000Z')
  })
})
