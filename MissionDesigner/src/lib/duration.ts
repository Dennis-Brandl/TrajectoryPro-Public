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

/** Timed GATE delays (spec 2026-10-13 §4.1): entered as weeks/days/hours/minutes/seconds,
 *  exported as whole seconds. Kept as parts on the node so "90 min" stays 90 min in the boxes. */
export type DurationParts = { weeks?: number; days?: number; hours?: number; minutes?: number; seconds?: number }

/** 52 weeks — the engine's GATE_MAX_DELAY_SECONDS. */
export const MAX_DELAY_SECONDS = 31_449_600

const UNIT_SECONDS = { weeks: 604_800, days: 86_400, hours: 3_600, minutes: 60, seconds: 1 } as const
const UNIT_LABELS: Array<[keyof typeof UNIT_SECONDS, string]> = [
  ['weeks', 'wk'],
  ['days', 'd'],
  ['hours', 'h'],
  ['minutes', 'min'],
  ['seconds', 's'],
]

export function joinDuration(parts?: DurationParts): number {
  if (!parts) return 0
  let total = 0
  for (const [key, size] of Object.entries(UNIT_SECONDS) as Array<[keyof typeof UNIT_SECONDS, number]>) {
    total += (parts[key] ?? 0) * size
  }
  return total
}

export function splitDuration(totalSeconds: number): Required<DurationParts> {
  let rest = Math.max(0, Math.floor(totalSeconds))
  const out = { weeks: 0, days: 0, hours: 0, minutes: 0, seconds: 0 }
  for (const [key] of UNIT_LABELS) {
    out[key] = Math.floor(rest / UNIT_SECONDS[key])
    rest -= out[key] * UNIT_SECONDS[key]
  }
  return out
}

/** '2 h 10 min 20 s' — every non-zero unit, largest first; 0 → '0 s'. Same rule as the
 *  engine's step-handlers.ts formatDuration. */
export function formatDuration(totalSeconds: number): string {
  const parts = splitDuration(totalSeconds)
  const shown = UNIT_LABELS.filter(([key]) => parts[key] > 0).map(([key, label]) => `${parts[key]} ${label}`)
  return shown.length > 0 ? shown.join(' ') : '0 s'
}
