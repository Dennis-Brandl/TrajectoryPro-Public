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

import { RuntimeId } from '../frame/RuntimeId'
import type { WhereData, WhereKind } from './where'

// Icon AND word for every state (colour is never the only cue, spec §11).
const ICON: Record<WhereKind, string> = { done: '✓', current: '●', active: '◐', problem: '✕', todo: '○' }

export interface WhereYouAreProps {
  runtimeLabel: string
  data: WhereData
  /** The sheet supplies its own title. */
  showTitle?: boolean
}

export function WhereYouAre({ runtimeLabel, data, showTitle = true }: WhereYouAreProps) {
  return (
    <nav className="where" aria-label={`Where you are in ${runtimeLabel}`}>
      {showTitle && (
        <h3 className="where-title">
          Where you are in <RuntimeId label={runtimeLabel} />
        </h3>
      )}
      {data.status === 'loading' ? (
        <p className="where-note" role="status">
          Loading steps…
        </p>
      ) : data.status === 'unavailable' ? (
        <p className="where-note">Steps are unavailable right now.</p>
      ) : (
        <ol className="where-list">
          {data.items.map((item) => (
            <li key={item.oid} className={`where-step where-${item.kind}`} aria-current={item.current ? 'step' : undefined}>
              <span className="where-icon" aria-hidden="true">
                {ICON[item.kind]}
              </span>
              <span className="where-name">{item.name}</span>
              <span className="where-state">{item.current ? 'You are here' : item.stateText}</span>
            </li>
          ))}
        </ol>
      )}
    </nav>
  )
}
