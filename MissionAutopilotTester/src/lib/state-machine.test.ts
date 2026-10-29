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
import { isCommandValid, OBSERVABLE_COMMANDS, OPAQUE_COMMANDS } from './state-machine'

describe('isCommandValid — observable', () => {
  it('PAUSE only from EXECUTING', () => {
    expect(isCommandValid('observable', 'EXECUTING', 'PAUSE')).toBe(true)
    expect(isCommandValid('observable', 'PAUSED', 'PAUSE')).toBe(false)
    expect(isCommandValid('observable', 'STARTING', 'PAUSE')).toBe(false)
  })

  it('RESUME only from PAUSED', () => {
    expect(isCommandValid('observable', 'PAUSED', 'RESUME')).toBe(true)
    expect(isCommandValid('observable', 'EXECUTING', 'RESUME')).toBe(false)
  })

  it('UNHOLD only from HELD', () => {
    expect(isCommandValid('observable', 'HELD', 'UNHOLD')).toBe(true)
    expect(isCommandValid('observable', 'HOLDING', 'UNHOLD')).toBe(false)
  })

  it('CLEAR only from ABORTED', () => {
    expect(isCommandValid('observable', 'ABORTED', 'CLEAR')).toBe(true)
    expect(isCommandValid('observable', 'COMPLETED', 'CLEAR')).toBe(false)
  })

  const ACTIVE = [
    'STARTING',
    'EXECUTING',
    'COMPLETING',
    'PAUSING',
    'PAUSED',
    'UNPAUSING',
    'HOLDING',
    'HELD',
    'UNHOLDING',
  ] as const

  it.each(ACTIVE)('HOLD valid from %s', (state) => {
    expect(isCommandValid('observable', state, 'HOLD')).toBe(true)
  })

  it.each(ACTIVE)('ABORT valid from %s', (state) => {
    expect(isCommandValid('observable', state, 'ABORT')).toBe(true)
  })

  it.each(ACTIVE)('STOP valid from %s', (state) => {
    expect(isCommandValid('observable', state, 'STOP')).toBe(true)
  })

  it.each(['ABORTING', 'STOPPING', 'CLEARING', 'COMPLETED', 'ABORTED'])(
    'HOLD invalid from inactive state %s',
    (state) => {
      expect(isCommandValid('observable', state, 'HOLD')).toBe(false)
    }
  )
})

describe('isCommandValid — opaque', () => {
  it('ABORT valid from POSTED, RECEIVED, IN_PROGRESS', () => {
    expect(isCommandValid('opaque', 'POSTED', 'ABORT')).toBe(true)
    expect(isCommandValid('opaque', 'RECEIVED', 'ABORT')).toBe(true)
    expect(isCommandValid('opaque', 'IN_PROGRESS', 'ABORT')).toBe(true)
  })

  it('ABORT invalid from terminal opaque states', () => {
    expect(isCommandValid('opaque', 'COMPLETED', 'ABORT')).toBe(false)
    expect(isCommandValid('opaque', 'ABORTED', 'ABORT')).toBe(false)
  })

  it('observable-only commands always invalid for opaque', () => {
    expect(isCommandValid('opaque', 'IN_PROGRESS', 'PAUSE')).toBe(false)
    expect(isCommandValid('opaque', 'IN_PROGRESS', 'HOLD')).toBe(false)
    expect(isCommandValid('opaque', 'IN_PROGRESS', 'UNHOLD')).toBe(false)
    expect(isCommandValid('opaque', 'IN_PROGRESS', 'RESUME')).toBe(false)
    expect(isCommandValid('opaque', 'IN_PROGRESS', 'CLEAR')).toBe(false)
  })
})

describe('command lists', () => {
  it('OBSERVABLE_COMMANDS is the 7-command set', () => {
    expect(OBSERVABLE_COMMANDS).toEqual([
      'PAUSE',
      'RESUME',
      'HOLD',
      'UNHOLD',
      'ABORT',
      'STOP',
      'CLEAR',
    ])
  })

  it('OPAQUE_COMMANDS is ABORT only', () => {
    expect(OPAQUE_COMMANDS).toEqual(['ABORT'])
  })
})
