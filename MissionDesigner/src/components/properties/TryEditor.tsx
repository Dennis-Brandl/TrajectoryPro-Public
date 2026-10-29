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

const ALL_MODES = ['ERROR', 'ABORT', 'TIMEOUT'] as const

export interface TrySpec {
  mode: 'ERROR' | 'ABORT' | 'TIMEOUT'
  catch_id: string
  release_on_catch?: boolean
}

interface Props {
  value: TrySpec[]
  onChange: (next: TrySpec[]) => void
  availableCatches: Array<{ catchId: string }>
  hideHeading?: boolean
}

export function TryEditor({ value, onChange, availableCatches, hideHeading = false }: Props) {
  const used = new Set(value.map((t) => t.mode))
  const firstMode = ALL_MODES.find((m) => !used.has(m)) ?? 'ERROR'
  const firstCatch = availableCatches[0]?.catchId ?? ''
  const add = () => onChange([...value, { mode: firstMode, catch_id: firstCatch, release_on_catch: true }])
  const update = (i: number, patch: Partial<TrySpec>) =>
    onChange(value.map((t, j) => (j === i ? { ...t, ...patch } : t)))
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i))

  return (
    <section className={hideHeading ? '' : 'mt-3 border-t pt-3'}>
      <div className="flex items-center justify-between">
        {!hideHeading && <h4 className="text-xs font-semibold text-muted-foreground">TRY · error handling</h4>}
        <button
          type="button"
          onClick={add}
          disabled={used.size === ALL_MODES.length || availableCatches.length === 0}
          className="rounded border px-2 py-0.5 text-xs disabled:opacity-50"
        >
          + Add TRY
        </button>
      </div>
      <ul role="list" className="mt-2 space-y-2">
        {value.map((row, i) => (
          <li role="listitem" key={row.mode} className="flex flex-wrap items-center gap-2 text-xs">
            <label className="flex items-center gap-1">
              ON
              <select value={row.mode} onChange={(e) => update(i, { mode: e.target.value as TrySpec['mode'] })}>
                {ALL_MODES.filter((m) => m === row.mode || !used.has(m)).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1">
              CATCH
              <select value={row.catch_id} onChange={(e) => update(i, { catch_id: e.target.value })}>
                {availableCatches.map((c) => (
                  <option key={c.catchId} value={c.catchId}>
                    {c.catchId}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={row.release_on_catch !== false}
                onChange={(e) => update(i, { release_on_catch: e.target.checked })}
              />
              Release resources on catch
            </label>
            <button type="button" aria-label="Remove TRY" onClick={() => remove(i)}>
              ✕
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
