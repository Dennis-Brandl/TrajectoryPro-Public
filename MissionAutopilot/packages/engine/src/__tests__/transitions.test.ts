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
  TRANSITION_TABLE,
  OPAQUE_TRANSITION_TABLE,
  AUTO_ADVANCE,
  OPAQUE_AUTO_ADVANCE,
  validateCommand,
} from '../state-machine/transitions.js'
import { ANY_ACTIVE_STATES } from '../state-machine/states.js'
import { InvalidStateTransitionError } from '../errors.js'

// ============================================================
// TRANSITION_TABLE tests
// ============================================================

describe('TRANSITION_TABLE', () => {
  describe('PAUSE command', () => {
    it('PAUSE from EXECUTING returns PAUSING', () => {
      expect(TRANSITION_TABLE.get('EXECUTING')?.get('PAUSE')).toBe('PAUSING')
    })

    it('PAUSE from STARTING is not defined', () => {
      expect(TRANSITION_TABLE.get('STARTING')?.get('PAUSE')).toBeUndefined()
    })

    it('PAUSE from COMPLETED is not defined', () => {
      expect(TRANSITION_TABLE.get('COMPLETED')?.get('PAUSE')).toBeUndefined()
    })

    it('PAUSE from PAUSED is not defined', () => {
      expect(TRANSITION_TABLE.get('PAUSED')?.get('PAUSE')).toBeUndefined()
    })
  })

  describe('RESUME command', () => {
    it('RESUME from PAUSED returns UNPAUSING', () => {
      expect(TRANSITION_TABLE.get('PAUSED')?.get('RESUME')).toBe('UNPAUSING')
    })

    it('RESUME from EXECUTING is not defined', () => {
      expect(TRANSITION_TABLE.get('EXECUTING')?.get('RESUME')).toBeUndefined()
    })

    it('RESUME from STARTING is not defined', () => {
      expect(TRANSITION_TABLE.get('STARTING')?.get('RESUME')).toBeUndefined()
    })
  })

  describe('HOLD command (CONTEXT.md: valid from ALL active states)', () => {
    it('HOLD from EXECUTING returns HOLDING', () => {
      expect(TRANSITION_TABLE.get('EXECUTING')?.get('HOLD')).toBe('HOLDING')
    })

    it('HOLD from STARTING returns HOLDING', () => {
      expect(TRANSITION_TABLE.get('STARTING')?.get('HOLD')).toBe('HOLDING')
    })

    it('HOLD from PAUSED returns HOLDING', () => {
      expect(TRANSITION_TABLE.get('PAUSED')?.get('HOLD')).toBe('HOLDING')
    })

    it('HOLD is valid from all 9 ANY_ACTIVE_STATES', () => {
      for (const state of ANY_ACTIVE_STATES) {
        expect(
          TRANSITION_TABLE.get(state)?.get('HOLD'),
          `Expected HOLD to be valid from ${state}`
        ).toBe('HOLDING')
      }
    })

    it('HOLD from COMPLETED is not defined', () => {
      expect(TRANSITION_TABLE.get('COMPLETED')?.get('HOLD')).toBeUndefined()
    })

    it('HOLD from ABORTED is not defined', () => {
      expect(TRANSITION_TABLE.get('ABORTED')?.get('HOLD')).toBeUndefined()
    })

    it('HOLD from ABORTING is not defined', () => {
      expect(TRANSITION_TABLE.get('ABORTING')?.get('HOLD')).toBeUndefined()
    })

    it('HOLD from STOPPING is not defined', () => {
      expect(TRANSITION_TABLE.get('STOPPING')?.get('HOLD')).toBeUndefined()
    })

    it('HOLD from CLEARING is not defined', () => {
      expect(TRANSITION_TABLE.get('CLEARING')?.get('HOLD')).toBeUndefined()
    })
  })

  describe('UNHOLD command', () => {
    it('UNHOLD from HELD returns UNHOLDING', () => {
      expect(TRANSITION_TABLE.get('HELD')?.get('UNHOLD')).toBe('UNHOLDING')
    })

    it('UNHOLD from EXECUTING is not defined', () => {
      expect(TRANSITION_TABLE.get('EXECUTING')?.get('UNHOLD')).toBeUndefined()
    })
  })

  describe('ABORT command', () => {
    it('ABORT is valid from all 9 ANY_ACTIVE_STATES', () => {
      for (const state of ANY_ACTIVE_STATES) {
        expect(
          TRANSITION_TABLE.get(state)?.get('ABORT'),
          `Expected ABORT to be valid from ${state}`
        ).toBe('ABORTING')
      }
    })

    it('ABORT from COMPLETED is not defined', () => {
      expect(TRANSITION_TABLE.get('COMPLETED')?.get('ABORT')).toBeUndefined()
    })

    it('ABORT from ABORTED is not defined', () => {
      expect(TRANSITION_TABLE.get('ABORTED')?.get('ABORT')).toBeUndefined()
    })
  })

  describe('STOP command', () => {
    it('STOP is valid from all 9 ANY_ACTIVE_STATES', () => {
      for (const state of ANY_ACTIVE_STATES) {
        expect(
          TRANSITION_TABLE.get(state)?.get('STOP'),
          `Expected STOP to be valid from ${state}`
        ).toBe('STOPPING')
      }
    })

    it('STOP from COMPLETED is not defined', () => {
      expect(TRANSITION_TABLE.get('COMPLETED')?.get('STOP')).toBeUndefined()
    })
  })

  describe('CLEAR command', () => {
    it('CLEAR from ABORTED returns CLEARING', () => {
      expect(TRANSITION_TABLE.get('ABORTED')?.get('CLEAR')).toBe('CLEARING')
    })

    it('CLEAR from COMPLETED is not defined', () => {
      expect(TRANSITION_TABLE.get('COMPLETED')?.get('CLEAR')).toBeUndefined()
    })

    it('CLEAR from EXECUTING is not defined', () => {
      expect(TRANSITION_TABLE.get('EXECUTING')?.get('CLEAR')).toBeUndefined()
    })
  })

  describe('SC (auto-advance) transitions', () => {
    it('STARTING SC -> EXECUTING', () => {
      expect(TRANSITION_TABLE.get('STARTING')?.get('SC')).toBe('EXECUTING')
    })

    it('EXECUTING SC -> COMPLETING', () => {
      expect(TRANSITION_TABLE.get('EXECUTING')?.get('SC')).toBe('COMPLETING')
    })

    it('COMPLETING SC -> COMPLETED', () => {
      expect(TRANSITION_TABLE.get('COMPLETING')?.get('SC')).toBe('COMPLETED')
    })

    it('PAUSING SC -> PAUSED', () => {
      expect(TRANSITION_TABLE.get('PAUSING')?.get('SC')).toBe('PAUSED')
    })

    it('UNPAUSING SC -> EXECUTING', () => {
      expect(TRANSITION_TABLE.get('UNPAUSING')?.get('SC')).toBe('EXECUTING')
    })

    it('HOLDING SC -> HELD', () => {
      expect(TRANSITION_TABLE.get('HOLDING')?.get('SC')).toBe('HELD')
    })

    it('UNHOLDING SC -> EXECUTING', () => {
      expect(TRANSITION_TABLE.get('UNHOLDING')?.get('SC')).toBe('EXECUTING')
    })

    it('ABORTING SC -> ABORTED', () => {
      expect(TRANSITION_TABLE.get('ABORTING')?.get('SC')).toBe('ABORTED')
    })

    it('STOPPING SC -> COMPLETED', () => {
      expect(TRANSITION_TABLE.get('STOPPING')?.get('SC')).toBe('COMPLETED')
    })

    it('CLEARING SC -> COMPLETED', () => {
      expect(TRANSITION_TABLE.get('CLEARING')?.get('SC')).toBe('COMPLETED')
    })
  })
})

// ============================================================
// AUTO_ADVANCE tests
// ============================================================

describe('AUTO_ADVANCE', () => {
  it('has exactly 10 entries', () => {
    expect(AUTO_ADVANCE.size).toBe(10)
  })

  it('STARTING -> EXECUTING', () => expect(AUTO_ADVANCE.get('STARTING')).toBe('EXECUTING'))
  it('EXECUTING -> COMPLETING', () => expect(AUTO_ADVANCE.get('EXECUTING')).toBe('COMPLETING'))
  it('COMPLETING -> COMPLETED', () => expect(AUTO_ADVANCE.get('COMPLETING')).toBe('COMPLETED'))
  it('PAUSING -> PAUSED', () => expect(AUTO_ADVANCE.get('PAUSING')).toBe('PAUSED'))
  it('UNPAUSING -> EXECUTING', () => expect(AUTO_ADVANCE.get('UNPAUSING')).toBe('EXECUTING'))
  it('HOLDING -> HELD', () => expect(AUTO_ADVANCE.get('HOLDING')).toBe('HELD'))
  it('UNHOLDING -> EXECUTING', () => expect(AUTO_ADVANCE.get('UNHOLDING')).toBe('EXECUTING'))
  it('ABORTING -> ABORTED', () => expect(AUTO_ADVANCE.get('ABORTING')).toBe('ABORTED'))
  it('STOPPING -> COMPLETED', () => expect(AUTO_ADVANCE.get('STOPPING')).toBe('COMPLETED'))
  it('CLEARING -> COMPLETED', () => expect(AUTO_ADVANCE.get('CLEARING')).toBe('COMPLETED'))

  it('COMPLETED has no auto-advance', () => expect(AUTO_ADVANCE.has('COMPLETED')).toBe(false))
  it('ABORTED has no auto-advance', () => expect(AUTO_ADVANCE.has('ABORTED')).toBe(false))
  it('PAUSED has no auto-advance (waits for RESUME)', () =>
    expect(AUTO_ADVANCE.has('PAUSED')).toBe(false))
  it('HELD has no auto-advance (waits for UNHOLD)', () =>
    expect(AUTO_ADVANCE.has('HELD')).toBe(false))
})

// ============================================================
// OPAQUE_TRANSITION_TABLE tests
// ============================================================

describe('OPAQUE_TRANSITION_TABLE', () => {
  describe('SC transitions', () => {
    it('POSTED SC -> RECEIVED', () => {
      expect(OPAQUE_TRANSITION_TABLE.get('POSTED')?.get('SC')).toBe('RECEIVED')
    })

    it('RECEIVED SC -> IN_PROGRESS', () => {
      expect(OPAQUE_TRANSITION_TABLE.get('RECEIVED')?.get('SC')).toBe('IN_PROGRESS')
    })

    it('IN_PROGRESS SC -> COMPLETED', () => {
      expect(OPAQUE_TRANSITION_TABLE.get('IN_PROGRESS')?.get('SC')).toBe('COMPLETED')
    })

    it('ABORTING SC -> ABORTED (recovery state can settle without a pinned ABORTING handler)', () => {
      expect(OPAQUE_TRANSITION_TABLE.get('ABORTING')?.get('SC')).toBe('ABORTED')
    })

    it('STOPPING SC -> COMPLETED (recovery state can settle without a pinned STOPPING handler)', () => {
      expect(OPAQUE_TRANSITION_TABLE.get('STOPPING')?.get('SC')).toBe('COMPLETED')
    })
  })

  describe('ABORT and STOP', () => {
    it('ABORT valid from POSTED', () => {
      expect(OPAQUE_TRANSITION_TABLE.get('POSTED')?.get('ABORT')).toBe('ABORTING')
    })

    it('ABORT valid from RECEIVED', () => {
      expect(OPAQUE_TRANSITION_TABLE.get('RECEIVED')?.get('ABORT')).toBe('ABORTING')
    })

    it('ABORT valid from IN_PROGRESS', () => {
      expect(OPAQUE_TRANSITION_TABLE.get('IN_PROGRESS')?.get('ABORT')).toBe('ABORTING')
    })

    it('STOP valid from POSTED', () => {
      expect(OPAQUE_TRANSITION_TABLE.get('POSTED')?.get('STOP')).toBe('STOPPING')
    })

    it('STOP valid from RECEIVED', () => {
      expect(OPAQUE_TRANSITION_TABLE.get('RECEIVED')?.get('STOP')).toBe('STOPPING')
    })

    it('STOP valid from IN_PROGRESS', () => {
      expect(OPAQUE_TRANSITION_TABLE.get('IN_PROGRESS')?.get('STOP')).toBe('STOPPING')
    })
  })

  describe('Unsupported commands', () => {
    it('PAUSE is not defined for any opaque state', () => {
      expect(OPAQUE_TRANSITION_TABLE.get('POSTED')?.get('PAUSE')).toBeUndefined()
      expect(OPAQUE_TRANSITION_TABLE.get('RECEIVED')?.get('PAUSE')).toBeUndefined()
      expect(OPAQUE_TRANSITION_TABLE.get('IN_PROGRESS')?.get('PAUSE')).toBeUndefined()
    })

    it('HOLD is not defined for any opaque state', () => {
      expect(OPAQUE_TRANSITION_TABLE.get('POSTED')?.get('HOLD')).toBeUndefined()
      expect(OPAQUE_TRANSITION_TABLE.get('IN_PROGRESS')?.get('HOLD')).toBeUndefined()
    })

    it('RESUME is not defined for any opaque state', () => {
      expect(OPAQUE_TRANSITION_TABLE.get('RECEIVED')?.get('RESUME')).toBeUndefined()
    })
  })
})

// ============================================================
// OPAQUE_AUTO_ADVANCE tests
// ============================================================

describe('OPAQUE_AUTO_ADVANCE', () => {
  it('has exactly 5 entries (3 happy-path + 2 recovery → terminal)', () => {
    // The recovery → terminal entries (ABORTING → ABORTED, STOPPING → COMPLETED)
    // mirror the observable AUTO_ADVANCE map and exist so an opaque action that
    // fell into a recovery state — typically via executeCode synthesizing
    // enterState('ABORTING') after a Python exception — can finish settling
    // instead of sticking at ABORTING/STOPPING forever.
    expect(OPAQUE_AUTO_ADVANCE.size).toBe(5)
  })

  it('POSTED -> RECEIVED', () => expect(OPAQUE_AUTO_ADVANCE.get('POSTED')).toBe('RECEIVED'))
  it('RECEIVED -> IN_PROGRESS', () =>
    expect(OPAQUE_AUTO_ADVANCE.get('RECEIVED')).toBe('IN_PROGRESS'))
  it('IN_PROGRESS -> COMPLETED', () =>
    expect(OPAQUE_AUTO_ADVANCE.get('IN_PROGRESS')).toBe('COMPLETED'))
  it('ABORTING -> ABORTED (recovery → terminal)', () =>
    expect(OPAQUE_AUTO_ADVANCE.get('ABORTING')).toBe('ABORTED'))
  it('STOPPING -> COMPLETED (recovery → terminal)', () =>
    expect(OPAQUE_AUTO_ADVANCE.get('STOPPING')).toBe('COMPLETED'))
})

// ============================================================
// validateCommand tests
// ============================================================

describe('validateCommand', () => {
  describe('observable actions', () => {
    it('returns PAUSING for PAUSE from EXECUTING', () => {
      expect(validateCommand('EXECUTING', 'PAUSE', 'observable')).toBe('PAUSING')
    })

    it('returns UNPAUSING for RESUME from PAUSED', () => {
      expect(validateCommand('PAUSED', 'RESUME', 'observable')).toBe('UNPAUSING')
    })

    it('returns HOLDING for HOLD from EXECUTING', () => {
      expect(validateCommand('EXECUTING', 'HOLD', 'observable')).toBe('HOLDING')
    })

    it('returns STOPPING for STOP from EXECUTING', () => {
      expect(validateCommand('EXECUTING', 'STOP', 'observable')).toBe('STOPPING')
    })

    it('throws InvalidStateTransitionError for PAUSE from STARTING', () => {
      expect(() => validateCommand('STARTING', 'PAUSE', 'observable')).toThrow(
        InvalidStateTransitionError
      )
    })

    it('throws InvalidStateTransitionError for PAUSE from COMPLETED', () => {
      expect(() => validateCommand('COMPLETED', 'PAUSE', 'observable')).toThrow(
        InvalidStateTransitionError
      )
    })

    it('thrown error has correct currentState and command', () => {
      try {
        validateCommand('COMPLETED', 'PAUSE', 'observable')
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidStateTransitionError)
        const e = err as InvalidStateTransitionError
        expect(e.currentState).toBe('COMPLETED')
        expect(e.command).toBe('PAUSE')
        expect(e.code).toBe('INVALID_STATE_TRANSITION')
      }
    })

    it('thrown error message contains state and command', () => {
      try {
        validateCommand('ABORTED', 'STOP', 'observable')
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidStateTransitionError)
        const e = err as InvalidStateTransitionError
        expect(e.message).toContain('STOP')
        expect(e.message).toContain('ABORTED')
      }
    })
  })

  describe('opaque actions', () => {
    it('returns RECEIVED for SC from POSTED', () => {
      expect(validateCommand('POSTED', 'SC', 'opaque')).toBe('RECEIVED')
    })

    it('returns ABORTING for ABORT from IN_PROGRESS', () => {
      expect(validateCommand('IN_PROGRESS', 'ABORT', 'opaque')).toBe('ABORTING')
    })

    it('throws for PAUSE from POSTED (opaque does not support PAUSE)', () => {
      expect(() => validateCommand('POSTED', 'PAUSE', 'opaque')).toThrow(
        InvalidStateTransitionError
      )
    })

    it('throws for HOLD from IN_PROGRESS (opaque does not support HOLD)', () => {
      expect(() => validateCommand('IN_PROGRESS', 'HOLD', 'opaque')).toThrow(
        InvalidStateTransitionError
      )
    })
  })
})
