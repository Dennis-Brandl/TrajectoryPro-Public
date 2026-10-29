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

import { useEffect, useState } from 'react'
import { Pill } from '../../components/Pill'
import { pillVariantForState } from '../../lib/state-pill'
import type { StateEntry } from '../../api/types'
import styles from './StateTimeline.module.css'

export interface StateTimelineProps {
  history: StateEntry[]
  terminal: boolean
  onSelectState?: (state: string, index: number) => void
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function StateTimeline({
  history,
  terminal,
  onSelectState,
}: StateTimelineProps) {
  // setInterval triggers a re-render every second; the actual elapsed time is
  // computed from Date.now() at render time so an instance that was already
  // running before this component mounted shows its real elapsed duration.
  const [, setTickCount] = useState(0)
  useEffect(() => {
    if (terminal) return
    const id = setInterval(() => setTickCount((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [terminal])

  if (history.length === 0) return null

  const lastIndex = history.length - 1
  const now = Date.now()

  return (
    <ol className={styles.list} aria-label="State history">
      {history.map((entry, index) => {
        const isLast = index === lastIndex
        const liveMs = entry.duration_ms != null
          ? entry.duration_ms
          : isLast
            ? Math.max(0, now - new Date(entry.entered_at).getTime())
            : 0
        return (
          <li key={`${entry.state}-${entry.entered_at}-${index}`} className={styles.item}>
            <button
              type="button"
              className={styles.button}
              title={`Entered at ${entry.entered_at}`}
              onClick={() => onSelectState?.(entry.state, index)}
            >
              <Pill variant={pillVariantForState(entry.state)}>{entry.state}</Pill>
              <span className={styles.duration}>{formatDuration(liveMs)}</span>
            </button>
            {!isLast && <span className={styles.sep} aria-hidden="true">→</span>}
          </li>
        )
      })}
    </ol>
  )
}
