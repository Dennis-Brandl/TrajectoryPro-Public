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
import type { FormValues } from '@mission/form-schema'

export interface CompletionScreenProps {
  values: FormValues
  onRestart: () => void
}

export function CompletionScreen({ values, onRestart }: CompletionScreenProps) {
  const entries = Object.entries(values)
  return (
    <div className="fs-complete">
      <h2>Flow complete</h2>
      {entries.length === 0 ? (
        <p>No values were collected.</p>
      ) : (
        <dl className="fs-summary">
          {entries.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{Array.isArray(v) ? v.join(', ') : String(v)}</dd>
            </div>
          ))}
        </dl>
      )}
      <button type="button" onClick={onRestart}>
        Start over
      </button>
    </div>
  )
}
