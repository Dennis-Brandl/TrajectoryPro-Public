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
import type { ParameterDefaultSource } from '@mission/form-schema'
import type { ParameterSpec } from '@/types/nodes'

const label = 'text-gray-500 dark:text-gray-400'
const labelSt: React.CSSProperties = { fontSize: 11, display: 'block', marginBottom: 2 }
const ctrl = 'bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 border border-gray-300 dark:border-gray-600'
const ctrlSt: React.CSSProperties = {
  width: '100%',
  fontSize: 13,
  padding: '4px 8px',
  borderRadius: 4,
  boxSizing: 'border-box',
  outline: 'none',
}

/** Editor for a ParameterDefaultSource (static literal / value property / input parameter).
 *  Mirrors the placeholderSource mode-toggle pattern in DataSection. */
export function DefaultValueEditor({
  source,
  stepInputs,
  onChange,
}: {
  source: ParameterDefaultSource | undefined
  stepInputs: ParameterSpec[]
  onChange: (next: ParameterDefaultSource | undefined) => void
}) {
  const mode = source?.mode ?? 'static'
  return (
    <div style={{ marginBottom: 10 }}>
      <label htmlFor="tfk-default" className={label} style={labelSt}>
        Default Value
      </label>
      <select
        value={mode}
        onChange={(e) => {
          const m = e.target.value as ParameterDefaultSource['mode']
          onChange(m === 'static' && (source?.value ?? '') === '' ? undefined : { mode: m, value: source?.value ?? '' })
        }}
        className={ctrl}
        style={{ ...ctrlSt, marginBottom: 6, cursor: 'pointer' }}
      >
        <option value="static">Fixed text</option>
        <option value="property">Value Property</option>
        <option value="input">Input Parameter</option>
      </select>
      {mode === 'input' ? (
        <select
          id="tfk-default"
          value={source?.value ?? ''}
          onChange={(e) => onChange({ mode: 'input', value: e.target.value })}
          className={ctrl}
          style={{ ...ctrlSt, cursor: 'pointer' }}
        >
          <option value="">Select input parameter...</option>
          {stepInputs.map((p) => (
            <option key={p.id} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
      ) : (
        <input
          id="tfk-default"
          value={source?.value ?? ''}
          onChange={(e) =>
            onChange(e.target.value === '' && mode === 'static' ? undefined : { mode, value: e.target.value })
          }
          className={ctrl}
          style={ctrlSt}
          placeholder={mode === 'property' ? 'Value Property name' : 'Default text'}
        />
      )}
    </div>
  )
}
