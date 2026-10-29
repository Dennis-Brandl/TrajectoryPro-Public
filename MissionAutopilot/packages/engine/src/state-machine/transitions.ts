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

import { ANY_ACTIVE_STATES } from './states.js'
import { InvalidStateTransitionError } from '../errors.js'

// ============================================================
// Transition table builder
// ============================================================

/**
 * Build the observable state TRANSITION_TABLE.
 * Maps (fromState, command) -> toState for all valid transitions
 * per StateMachineSpec.md §2, with CONTEXT.md extensions.
 */
function buildTransitionTable(): Map<string, Map<string, string>> {
  const table = new Map<string, Map<string, string>>()

  function addTransition(from: string, command: string, to: string): void {
    if (!table.has(from)) {
      table.set(from, new Map<string, string>())
    }
    table.get(from)!.set(command, to)
  }

  // ---- Client commands ----

  // PAUSE: only from EXECUTING
  addTransition('EXECUTING', 'PAUSE', 'PAUSING')

  // RESUME: only from PAUSED
  addTransition('PAUSED', 'RESUME', 'UNPAUSING')

  // UNHOLD: only from HELD
  addTransition('HELD', 'UNHOLD', 'UNHOLDING')

  // CLEAR: only from ABORTED
  addTransition('ABORTED', 'CLEAR', 'CLEARING')

  // HOLD valid from ALL active states (CONTEXT.md extension: mirrors ABORT flexibility)
  for (const state of ANY_ACTIVE_STATES) {
    addTransition(state, 'HOLD', 'HOLDING')
  }

  // ABORT valid from ALL active states
  for (const state of ANY_ACTIVE_STATES) {
    addTransition(state, 'ABORT', 'ABORTING')
  }

  // STOP valid from ALL active states
  for (const state of ANY_ACTIVE_STATES) {
    addTransition(state, 'STOP', 'STOPPING')
  }

  // ---- SC (auto-advance) transitions ----
  addTransition('STARTING', 'SC', 'EXECUTING')
  addTransition('EXECUTING', 'SC', 'COMPLETING')
  addTransition('COMPLETING', 'SC', 'COMPLETED')
  addTransition('PAUSING', 'SC', 'PAUSED')
  addTransition('UNPAUSING', 'SC', 'EXECUTING')
  addTransition('HOLDING', 'SC', 'HELD')
  addTransition('UNHOLDING', 'SC', 'EXECUTING')
  addTransition('ABORTING', 'SC', 'ABORTED')
  addTransition('STOPPING', 'SC', 'COMPLETED')
  addTransition('CLEARING', 'SC', 'COMPLETED')

  return table
}

/**
 * Build the opaque state TRANSITION_TABLE.
 * Opaque actions support SC, ABORT, and STOP only (no PAUSE/RESUME/HOLD/UNHOLD).
 */
function buildOpaqueTransitionTable(): Map<string, Map<string, string>> {
  const table = new Map<string, Map<string, string>>()

  function addTransition(from: string, command: string, to: string): void {
    if (!table.has(from)) {
      table.set(from, new Map<string, string>())
    }
    table.get(from)!.set(command, to)
  }

  // SC auto-advance transitions
  addTransition('POSTED', 'SC', 'RECEIVED')
  addTransition('RECEIVED', 'SC', 'IN_PROGRESS')
  addTransition('IN_PROGRESS', 'SC', 'COMPLETED')

  // Recovery → terminal SC transitions. Opaque actions can land in ABORTING
  // (or STOPPING) two ways: an explicit ABORT/STOP command from a non-
  // terminal state, or an execution failure in executeCode() which
  // synthesizes `enterState(instanceId, 'ABORTING', { error })`. Without
  // these transitions there is no path out of ABORTING/STOPPING for opaque
  // actions and the instance sticks at the recovery state forever (matches
  // the symptom reported when BakeItem hit `int('')` and stalled at
  // ABORTING). The observable table has the equivalents — see line 60-62.
  addTransition('ABORTING', 'SC', 'ABORTED')
  addTransition('STOPPING', 'SC', 'COMPLETED')

  // ABORT and STOP from opaque active states
  const opaqueActive = ['POSTED', 'RECEIVED', 'IN_PROGRESS']
  for (const state of opaqueActive) {
    addTransition(state, 'ABORT', 'ABORTING')
    addTransition(state, 'STOP', 'STOPPING')
  }

  return table
}

// ============================================================
// Exported transition tables
// ============================================================

/** Observable state transition table: (fromState, command) -> toState */
export const TRANSITION_TABLE: Map<string, Map<string, string>> = buildTransitionTable()

/** Opaque state transition table: (fromState, command) -> toState */
export const OPAQUE_TRANSITION_TABLE: Map<
  string,
  Map<string, string>
> = buildOpaqueTransitionTable()

/**
 * Auto-advance map for observable states.
 * Maps each state to its SC-triggered next state.
 * States not in this map have no auto-advance (PAUSED, HELD, COMPLETED, ABORTED, etc.).
 */
export const AUTO_ADVANCE: Map<string, string> = new Map([
  ['STARTING', 'EXECUTING'],
  ['EXECUTING', 'COMPLETING'],
  ['COMPLETING', 'COMPLETED'],
  ['PAUSING', 'PAUSED'],
  ['UNPAUSING', 'EXECUTING'],
  ['HOLDING', 'HELD'],
  ['UNHOLDING', 'EXECUTING'],
  ['ABORTING', 'ABORTED'],
  ['STOPPING', 'COMPLETED'],
  ['CLEARING', 'COMPLETED'],
])

/**
 * Auto-advance map for opaque states.
 * Maps each opaque state to its SC-triggered next state.
 *
 * ABORTING/STOPPING are included so an opaque action that fell into a
 * recovery state (typically because executeCode hit a Python exception
 * and synthesized `enterState(... 'ABORTING' ...)`) auto-advances to the
 * terminal state instead of sticking at ABORTING/STOPPING forever. They
 * mirror the observable map's ABORTING/STOPPING entries.
 */
export const OPAQUE_AUTO_ADVANCE: Map<string, string> = new Map([
  ['POSTED', 'RECEIVED'],
  ['RECEIVED', 'IN_PROGRESS'],
  ['IN_PROGRESS', 'COMPLETED'],
  ['ABORTING', 'ABORTED'],
  ['STOPPING', 'COMPLETED'],
])

// ============================================================
// Command validation
// ============================================================

/**
 * Validate a command against the transition table for the given state.
 * Returns the target state if valid.
 * Throws InvalidStateTransitionError if the command is not valid for the current state.
 */
export function validateCommand(
  currentState: string,
  command: string,
  visibility: 'observable' | 'opaque'
): string {
  const table = visibility === 'opaque' ? OPAQUE_TRANSITION_TABLE : TRANSITION_TABLE
  const stateTransitions = table.get(currentState)

  if (!stateTransitions) {
    throw new InvalidStateTransitionError(currentState, command)
  }

  const targetState = stateTransitions.get(command)
  if (targetState === undefined) {
    throw new InvalidStateTransitionError(currentState, command)
  }

  return targetState
}
