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

import type { DiagramSpec, DiagramStep, PilotLiveStep } from '../api/types'
import { humaniseState, IDLE_STATE } from '../screens/workflows/state'

export type WhereKind = 'done' | 'current' | 'active' | 'problem' | 'todo'

export interface WhereItem {
  oid: string
  name: string
  kind: WhereKind
  /** The engine state in words ("Completed", "Not started", …). */
  stateText: string
  current: boolean
}

export interface WhereData {
  status: 'loading' | 'unavailable' | 'ready'
  items: WhereItem[]
}

const ENDPOINTS = new Set(['START', 'END'])

/** The (sub-)workflow whose own steps include `stepOid`; null when no level has it. */
export function findSpecWithStep(spec: DiagramSpec, stepOid: string): DiagramSpec | null {
  if (spec.steps.some((s) => s.oid === stepOid)) return spec
  for (const child of spec.children) {
    const hit = findSpecWithStep(child, stepOid)
    if (hit) return hit
  }
  return null
}

/** Reading order for an operator: a walk from START along the connections (branches and
 *  loops visit each step once), then steps no connection reaches, top to bottom. START
 *  and END are drawing aids, not work, so they are left out. */
export function orderSteps(spec: DiagramSpec): DiagramStep[] {
  const byOid = new Map(spec.steps.map((s) => [s.oid, s]))
  const next = new Map<string, string[]>()
  for (const c of spec.connections) next.set(c.fromStepOid, [...(next.get(c.fromStepOid) ?? []), c.toStepOid])

  const seen = new Set<string>()
  const walked: DiagramStep[] = []
  const queue = spec.steps.filter((s) => s.stepType === 'START').map((s) => s.oid)
  while (queue.length > 0) {
    const oid = queue.shift()!
    if (seen.has(oid)) continue
    seen.add(oid)
    const step = byOid.get(oid)
    if (step) walked.push(step)
    for (const to of next.get(oid) ?? []) if (!seen.has(to)) queue.push(to)
  }
  const rest = spec.steps.filter((s) => !seen.has(s.oid)).sort((a, b) => a.y - b.y || a.x - b.x)
  return [...walked, ...rest].filter((s) => !ENDPOINTS.has(s.stepType))
}

function kindOf(state: string): WhereKind {
  switch (state) {
    case 'COMPLETED':
      return 'done'
    case 'ERRORED':
    case 'ABORTED':
      return 'problem'
    case 'IDLE':
    case 'CANCELLED':
      return 'todo'
    default:
      return 'active'
  }
}

// Spec §4 "Where you are in <runtime>": the steps around this task, each with its state.
export function whereItems(root: DiagramSpec, live: Record<string, PilotLiveStep>, stepOid: string): WhereItem[] {
  const spec = findSpecWithStep(root, stepOid) ?? root
  return orderSteps(spec).map((s) => {
    const state = live[s.oid]?.state ?? IDLE_STATE
    const current = s.oid === stepOid
    return { oid: s.oid, name: s.name || s.oid, kind: current ? 'current' : kindOf(state), stateText: humaniseState(state), current }
  })
}
