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

import { useEffect, useRef } from 'react'
import type { WaitingStep } from '../api/types'
import { RuntimeId } from '../frame/RuntimeId'
import { useNow } from '../frame/useNow'
import { gateTimerText } from './gate-timer-text'
import { ContinueNowControl } from './ContinueNowControl'

export interface WaitingSectionProps {
  waiting: WaitingStep[]
  offline: boolean
  refresh(): Promise<void>
}

// Spec 2026-10-13 §5.3/§6.7: the work center's timed gates and repeating scripts, soonest first, each with Continue now.
export function WaitingSection({ waiting, offline, refresh }: WaitingSectionProps) {
  const now = useNow(1000)
  // A gate the timer opened (or a script whose time limit ran out) leaves the list on the next snapshot — ask for it once per step,
  // the moment its countdown reaches zero (the engine also NOTIFYs; this covers a missed push).
  const refreshedFor = useRef(new Set<string>())
  useEffect(() => {
    for (const w of waiting) {
      if (w.timer.deadline !== null && Date.parse(w.timer.deadline) <= now && !refreshedFor.current.has(w.stepInstanceId)) {
        refreshedFor.current.add(w.stepInstanceId)
        refresh().catch(() => {})
      }
    }
  }, [waiting, now, refresh])

  if (waiting.length === 0) return null
  return (
    <section className="inbox-section" aria-labelledby="inbox-waiting-heading">
      <div className="inbox-section-head">
        <h2 id="inbox-waiting-heading">Waiting</h2>
        <span className="inbox-count">{waiting.length}</span>
      </div>
      <ul className="inbox-list">
        {waiting.map((w) => {
          const name = w.stepName ?? w.stepOid
          const path = w.workflowPath.length > 0 ? ` › ${w.workflowPath.join(' › ')}` : ''
          return (
            <li key={w.stepInstanceId} className={w.paused ? 'inbox-row inbox-row-paused' : 'inbox-row'}>
              <div className="inbox-step">
                <span className="inbox-step-name">{name}</span>
                {w.paused && <span className="inbox-badge inbox-badge-paused">Paused</span>}
              </div>
              <div className="inbox-workflow">{w.masterVersion ? `${w.masterName} v${w.masterVersion}` : w.masterName}{path}</div>
              <div className="inbox-runtime"><RuntimeId label={w.runtimeLabel} /></div>
              <div className="inbox-age">{gateTimerText(w.timer, now)}</div>
              <div className="inbox-action">
                <ContinueNowControl instanceId={w.instanceId} stepInstanceId={w.stepInstanceId} stepName={name}
                  disabled={offline || w.paused} disabledReason={w.paused ? 'Resume the workflow first' : 'Offline'}
                  onDone={() => { refresh().catch(() => {}) }} />
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
