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
// CM port of pure display-state helpers for the Workflows tab (spec 2026-08-19 §3.3/§4.2).
// resolveDisplayState is the port of the free Runtime's resolveStepStates default-
// to-IDLE pass — the server already reduced step_instance rows to latest-per-step,
// so no trace overlay is needed here. colorFor keys on the DB state vocabulary
// (READY/WAITING_ACTION/WAITING_USER…), unlike the Runtime original (WAITING/IDLE).
import type { PilotLiveStep, DiagramSpec } from '@/lib/api/types'

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
  switch (state) {
    case 'COMPLETED':
      return { fill: '#4ade80', opacity: 0.9 }
    case 'WAITING_SCRIPT':
    case 'EXECUTING':
      return { fill: '#3b82f6', stroke: '#93c5fd', strokeWidth: 3 }
    case 'WAITING_USER':
    case 'WAITING_ACTION':
    case 'READY':
      return { fill: '#93c5fd' }
    case 'PAUSED':
      return { fill: '#eab308' }
    case 'WAITING_GATE':
      return { fill: '#f59e0b' }
    case 'WAITING_PROPERTIES':
      return { fill: '#fbbf24' }
    case 'ERRORED':
      return { fill: '#ef4444' }
    case 'ABORTED':
      return { fill: '#ef4444', opacity: 0.45 }
    case 'CANCELLED':
      return { fill: '#6b7280', opacity: 0.5, dashed: true }
    default: // IDLE and anything the engine grows later
      return { fill: '#6b7280', opacity: 0.7 }
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
