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

import { Input } from '@mission/ui'
import { formatDuration, joinDuration, MAX_DELAY_SECONDS, type DurationParts } from '@/lib/duration'

const FIELDS: Array<{ key: keyof DurationParts; label: string; unit: string }> = [
  { key: 'weeks', label: 'Weeks', unit: 'wk' },
  { key: 'days', label: 'Days', unit: 'd' },
  { key: 'hours', label: 'Hours', unit: 'h' },
  { key: 'minutes', label: 'Minutes', unit: 'min' },
  { key: 'seconds', label: 'Seconds', unit: 's' },
]

/** Spec 2026-10-13 §4.3: five side-by-side whole-number boxes; blank = 0; live total read-back.
 *  The parts are kept exactly as typed — the read-back shows the normalized total.
 *  Only non-negative integers are ever stored, so export can never emit a fractional delay. */
export function DurationInput({
  idPrefix,
  value,
  onChange,
  emptyText,
}: {
  idPrefix: string
  value: DurationParts | undefined
  onChange: (next: DurationParts) => void
  /** Shown, muted, when the total is zero — for an optional duration (e.g. "No time limit"). Absent = the red "Enter a delay". */
  emptyText?: string
}) {
  const parts = value ?? {}
  const total = joinDuration(parts)
  const set = (key: keyof DurationParts, raw: string) => {
    if (raw === '') {
      const { [key]: _omit, ...rest } = parts
      onChange(rest)
      return
    }
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 0) return
    onChange({ ...parts, [key]: n === 0 ? 0 : n }) // normalizes -0
  }
  return (
    <div className="space-y-1">
      <div className="flex gap-1">
        {FIELDS.map((f) => (
          <label key={f.key} className="flex items-center gap-0.5 text-xs text-slate-500 dark:text-slate-400">
            <Input
              id={`${idPrefix}-${f.key}`}
              aria-label={f.label}
              type="number"
              min={0}
              step={1}
              className="h-8 w-14 px-1 text-sm"
              value={parts[f.key] ?? ''}
              onChange={(e) => set(f.key, e.target.value)}
            />
            {f.unit}
          </label>
        ))}
      </div>
      {total < 1 && emptyText ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">{emptyText}</p>
      ) : total < 1 ? (
        <p className="text-xs text-red-600 dark:text-red-400">Enter a delay</p>
      ) : total > MAX_DELAY_SECONDS ? (
        <p className="text-xs text-red-600 dark:text-red-400">Longer than 52 weeks</p>
      ) : (
        <p className="text-xs text-slate-500 dark:text-slate-400">Total: {formatDuration(total)}</p>
      )}
    </div>
  )
}
