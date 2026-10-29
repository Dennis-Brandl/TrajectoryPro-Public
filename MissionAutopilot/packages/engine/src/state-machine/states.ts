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

// ============================================================
// Observable state literal types (ISA-88 inspired)
// ============================================================

export type ObservableState =
  | 'STARTING'
  | 'EXECUTING'
  | 'COMPLETING'
  | 'COMPLETED'
  | 'PAUSING'
  | 'PAUSED'
  | 'UNPAUSING'
  | 'HOLDING'
  | 'HELD'
  | 'UNHOLDING'
  | 'ABORTING'
  | 'ABORTED'
  | 'CLEARING'
  | 'STOPPING'

// ============================================================
// Opaque state literal types
// ============================================================

export type OpaqueState = 'POSTED' | 'RECEIVED' | 'IN_PROGRESS' | 'COMPLETED'

// ============================================================
// Union of all action states
// ============================================================

export type ActionState = ObservableState | OpaqueState

// ============================================================
// Commands
// ============================================================

/**
 * All state machine commands.
 * SC is the internal "state complete" event (not a client command).
 */
export type Command = 'SC' | 'PAUSE' | 'RESUME' | 'HOLD' | 'UNHOLD' | 'ABORT' | 'STOP' | 'CLEAR'

/**
 * Commands that can originate from a client (excludes SC).
 */
export type ClientCommand = Exclude<Command, 'SC'>

// ============================================================
// State sets
// ============================================================

export const OBSERVABLE_STATES: readonly ObservableState[] = [
  'STARTING',
  'EXECUTING',
  'COMPLETING',
  'COMPLETED',
  'PAUSING',
  'PAUSED',
  'UNPAUSING',
  'HOLDING',
  'HELD',
  'UNHOLDING',
  'ABORTING',
  'ABORTED',
  'CLEARING',
  'STOPPING',
]

export const OPAQUE_STATES: readonly OpaqueState[] = [
  'POSTED',
  'RECEIVED',
  'IN_PROGRESS',
  'COMPLETED',
]

/**
 * The 9 active observable states — those from which ABORT, STOP, and HOLD are valid.
 * Does NOT include terminal states (COMPLETED, ABORTED) or transition-only states
 * (ABORTING, STOPPING, CLEARING) — those are not "active" per StateMachineSpec.md §2.
 */
export const ANY_ACTIVE_STATES: readonly ObservableState[] = [
  'STARTING',
  'EXECUTING',
  'COMPLETING',
  'PAUSING',
  'PAUSED',
  'UNPAUSING',
  'HOLDING',
  'HELD',
  'UNHOLDING',
]

export const TERMINAL_STATES = ['COMPLETED', 'ABORTED'] as const

// ============================================================
// Helper functions
// ============================================================

export function isTerminal(state: string): boolean {
  return (TERMINAL_STATES as readonly string[]).includes(state)
}

export function isActiveState(state: string): boolean {
  return (ANY_ACTIVE_STATES as readonly string[]).includes(state)
}
