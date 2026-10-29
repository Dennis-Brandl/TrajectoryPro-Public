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
//
// Pure display-state helpers for the Workflows tab (spec 2026-08-19 §3.3/§4.2).
// resolveDisplayState is the port of the free Runtime's resolveStepStates default-
// to-IDLE pass — the server already reduced step_instance rows to latest-per-step,
// so no trace overlay is needed here. colorFor keys on the DB state vocabulary
// (READY/WAITING_ACTION/WAITING_USER…), unlike the Runtime original (WAITING/IDLE).
import type { PilotLiveStep, DiagramSpec } from '../../api/types'

export const IDLE_STATE = 'IDLE'

export type StepVisual = {
  fill: string
  opacity?: number
  stroke?: string
  strokeWidth?: number
  dashed?: boolean
}

export function resolveDisplayState(
  spec: DiagramSpec,
  steps: Record<string, PilotLiveStep>,
): Map<string, string> {
  const m = new Map<string, string>()
  for (const s of spec.steps) m.set(s.oid, steps[s.oid]?.state ?? IDLE_STATE)
  return m
}

export function colorFor(state: string): StepVisual {
  // Fixed (F) state tokens from src/theme/tokens.css — never themeable (ISA-101).
  switch (state) {
    case 'COMPLETED':
      return { fill: 'var(--pilot-state-completed)', opacity: 0.9 }
    case 'WAITING_SCRIPT':
    case 'EXECUTING':
      return { fill: 'var(--pilot-state-executing)', stroke: 'var(--pilot-state-executing-ring)', strokeWidth: 3 }
    case 'WAITING_USER':
    case 'WAITING_ACTION':
    case 'READY':
      return { fill: 'var(--pilot-state-waiting)' }
    case 'PAUSED':
      return { fill: 'var(--pilot-state-paused)' }
    case 'WAITING_GATE':
      return { fill: 'var(--pilot-state-gate)' }
    case 'WAITING_PROPERTIES':
      return { fill: 'var(--pilot-state-properties)' }
    case 'ERRORED':
      return { fill: 'var(--pilot-state-errored)' }
    case 'ABORTED':
      return { fill: 'var(--pilot-state-errored)', opacity: 0.45 }
    case 'CANCELLED':
      return { fill: 'var(--pilot-state-cancelled)', opacity: 0.5, dashed: true }
    default: // IDLE and anything the engine grows later
      return { fill: 'var(--pilot-state-idle)', opacity: 0.7 }
  }
}

export function humaniseState(state: string): string {
  switch (state) {
    case 'IDLE': return 'Not started'
    case 'READY': return 'Ready'
    case 'EXECUTING': return 'Executing'
    case 'WAITING_ACTION': return 'Waiting for action'
    case 'WAITING_USER': return 'Waiting for operator'
    case 'PAUSED': return 'Paused'
    case 'WAITING_GATE': return 'Waiting on gate'
    case 'WAITING_PROPERTIES': return 'Reading action properties'
    case 'WAITING_SCRIPT': return 'Running script'
    case 'COMPLETED': return 'Completed'
    case 'ERRORED': return 'Errored'
    case 'ABORTED': return 'Aborted'
    case 'CANCELLED': return 'Cancelled'
    default: return state
  }
}

export function findSpecByOid(root: DiagramSpec, oid: string): DiagramSpec | null {
  if (root.oid === oid) return root
  for (const c of root.children) {
    const hit = findSpecByOid(c, oid)
    if (hit) return hit
  }
  return null
}

/** Spec §5.7: a state is never told by colour alone — each fill family has a glyph, used on
 *  the diagram's node badges and in the legend. */
export function glyphFor(state: string): string {
  switch (state) {
    case 'COMPLETED':
      return '✓'
    case 'WAITING_SCRIPT':
    case 'EXECUTING':
      return '▶'
    case 'WAITING_USER':
    case 'WAITING_ACTION':
    case 'READY':
    case 'WAITING_PROPERTIES':
      return '◐'
    case 'WAITING_GATE':
      return '◇'
    case 'PAUSED':
      return '‖'
    case 'ERRORED':
    case 'ABORTED':
      return '✕'
    case 'CANCELLED':
      return '–'
    default: // IDLE and anything the engine grows later
      return '○'
  }
}

/** The legend: one row per fill colour the diagram draws, with its glyph and a word. */
export const LEGEND: ReadonlyArray<readonly [state: string, word: string]> = [
  ['IDLE', 'Not started'], ['WAITING_USER', 'Waiting'], ['WAITING_GATE', 'Waiting on gate'], ['EXECUTING', 'Executing'],
  ['PAUSED', 'Paused'], ['COMPLETED', 'Completed'], ['ERRORED', 'Errored'], ['CANCELLED', 'Cancelled'],
]
