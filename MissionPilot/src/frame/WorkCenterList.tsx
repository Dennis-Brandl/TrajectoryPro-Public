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
import { api } from '../api/client'
import type { WorkCenter } from '../api/types'

export interface WorkCenterListProps {
  /** Marked aria-current — the switcher's current work center; the picker has none. */
  currentId?: string
  onChoose(wc: WorkCenter): void
}

type ListState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; workCenters: WorkCenter[] }

export function openTasksText(n: number): string {
  if (n === 0) return 'No open tasks'
  return n === 1 ? '1 open task' : `${n} open tasks`
}

// Spec §5.5: work centers as cards — name, path (parent › child), open-task count. Shared by
// the picker and the top-bar switcher. The button's accessible NAME is the bare work-center
// name (the e2e suites select on it with exact:true); path and count are its description.
export function WorkCenterList({ currentId, onChoose }: WorkCenterListProps) {
  const [list, setList] = useState<ListState>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    api.workCenters().then(
      (workCenters) => {
        if (!cancelled) setList({ kind: 'ready', workCenters })
      },
      () => {
        if (!cancelled) setList({ kind: 'error' })
      },
    )
    return () => {
      cancelled = true
    }
  }, [attempt])

  const retry = () => {
    setList({ kind: 'loading' })
    setAttempt((n) => n + 1)
  }

  if (list.kind === 'loading') return <p role="status">Loading work centers…</p>
  if (list.kind === 'error') {
    return (
      <div className="wc-list-error">
        <p role="alert">Could not load work centers.</p>
        <button type="button" onClick={retry}>
          Try again
        </button>
      </div>
    )
  }
  if (list.workCenters.length === 0) {
    return <p className="wc-list-empty">You are not a member of any work center yet. Ask an administrator to add you.</p>
  }
  return (
    <ul className="wc-cards">
      {list.workCenters.map((wc) => {
        const nameId = `wc-card-name-${wc.id}`
        const pathId = `wc-card-path-${wc.id}`
        const countId = `wc-card-count-${wc.id}`
        const hasPath = !!wc.path && wc.path.length > 0
        const hasCount = wc.openTasks !== undefined
        const described = [hasPath && pathId, hasCount && countId].filter(Boolean).join(' ')
        return (
          <li key={wc.id}>
            <button
              type="button"
              className="wc-card"
              aria-labelledby={nameId}
              aria-describedby={described || undefined}
              aria-current={wc.id === currentId ? 'true' : undefined}
              onClick={() => onChoose(wc)}
            >
              <span className="wc-card-name" id={nameId}>
                {wc.name}
              </span>
              <span className="wc-card-meta">
                {hasPath && (
                  <span className="wc-card-path" id={pathId}>
                    {wc.path!.join(' › ')}
                  </span>
                )}
                {hasCount && (
                  <span className="wc-card-count" id={countId}>
                    {openTasksText(wc.openTasks!)}
                  </span>
                )}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
