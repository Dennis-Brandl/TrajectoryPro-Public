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

import { useRef, useState, type ReactNode } from 'react'
import { api, ApiError } from '../api/client'
import { useToast } from '../toast'
import type { InboxTask, InboxSnapshot } from '../api/types'
import { WaitingSection } from '../inbox/WaitingSection'
import { ReleaseButton } from '../task/ReleaseButton'
import { clearDraft, draftCount } from '../task/drafts'
import { RuntimeId } from '../frame/RuntimeId'
import { workflowParts } from '../frame/ContextBar'
import { useNow } from '../frame/useNow'
import { formatAge, matchesFilter, waitingSince } from '../inbox/inbox-model'

export interface InboxScreenProps {
  snapshot: InboxSnapshot | null
  offline: boolean
  refresh(): Promise<void>
  onOpenTask(task: InboxTask): void
  // Called only when a release succeeds, so the work view can retire the pane
  // without treating it as an external removal.
  onReleased?(task: InboxTask): void
  /** Filter text and the open Release question, held by the work view so a layout switch
   *  (which moves the inbox between the tab panel and the Workstation column) keeps them. */
  query?: string
  onQueryChange?(query: string): void
  releaseAskingId?: string | null
  onReleaseAskingChange?(assignmentId: string | null): void
  /** Rendered inside the Workstation <aside>: a plain container, not a second <main>. */
  inRail?: boolean
}

const GENERIC_ERROR_COPY = 'Something went wrong — try again.'
const FILTER_LABEL = 'Filter by step, workflow or runtime ID'

// A claim/release can lose the race to another user between the offer being
// shown and the click (or be re-validated away by a revoked role) — the
// engine reports that as 403 or 409. That is the ONLY case that gets the
// specific "it's gone" copy; anything else (a real 500, a dropped network
// request, ...) gets the generic copy instead so a genuine failure isn't
// mislabeled as a lost race.
function isRaceLoss(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 403 || err.status === 409)
}

/** "3", or "1 of 3" while a filter hides some (Review Focus 2). */
function countText(shown: number, total: number): string {
  return shown === total ? String(total) : `${shown} of ${total}`
}

interface TaskRowProps {
  task: InboxTask
  now: number
  /** Present for an open claim: the step name reopens its pane. */
  onOpen?(): void
  children: ReactNode
}

// Spec §5.5: one row per task — step, workflow + version, runtime ID, age, action. The same
// markup is a full-width row from 1024 px and a card below it (pilot.css). Rows stay <li>
// with their buttons inside: the e2e suites find a task's Claim/Release by filtering items.
function TaskRow({ task, now, onOpen, children }: TaskRowProps) {
  const step = task.stepName ?? task.stepOid
  const since = waitingSince(task)
  return (
    <li className={task.paused ? 'inbox-row inbox-row-paused' : 'inbox-row'}>
      <div className="inbox-step">
        {onOpen ? (
          <button type="button" className="inbox-open" onClick={onOpen}>
            {step}
          </button>
        ) : (
          <span className="inbox-step-name">{step}</span>
        )}
        {task.paused && <span className="inbox-badge inbox-badge-paused">Paused</span>}
        {task.suggestedForMe && <span className="inbox-badge">Suggested for you</span>}
      </div>
      <div className="inbox-workflow">{workflowParts(task).join('')}</div>
      <div className="inbox-runtime">
        <RuntimeId label={task.runtimeLabel} />
      </div>
      <div className="inbox-age">
        <time dateTime={since}>{formatAge(since, now)}</time>
      </div>
      <div className="inbox-action">{children}</div>
    </li>
  )
}

// Presentational half of the old screen: the inbox no longer owns useInbox — the
// data layer lives in App so SSE/poll survive while the operator works in panes,
// and this component just renders whatever snapshot it is handed.
export function InboxScreen({ snapshot, offline, refresh, onOpenTask, onReleased, query: queryProp, onQueryChange, releaseAskingId, onReleaseAskingChange, inRail = false }: InboxScreenProps) {
  const { show } = useToast()
  const { myClaims, offers } = snapshot ?? { myClaims: [], offers: [] }
  const [localQuery, setLocalQuery] = useState('')
  const query = queryProp ?? localQuery
  const setQuery = onQueryChange ?? setLocalQuery
  const [localAskingId, setLocalAskingId] = useState<string | null>(null)
  const askingId = releaseAskingId !== undefined ? releaseAskingId : localAskingId
  const setAskingId = onReleaseAskingChange ?? setLocalAskingId
  const Root = inRail ? 'div' : 'main'
  const now = useNow(60_000)

  const claims = myClaims.filter((t) => matchesFilter(t, query))
  const available = offers.filter((t) => matchesFilter(t, query))
  const noMatch = `No tasks match “${query.trim()}”.`

  // A second tap while a claim is in flight would send a second POST, which the engine
  // answers 409 even for the same user, and the operator would see "no longer available"
  // for a claim that succeeded. The ref blocks a same-tick double click; the state disables
  // the button.
  const pendingRef = useRef<Set<string>>(new Set())
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  const setClaimPending = (id: string, on: boolean) => {
    if (on) pendingRef.current.add(id)
    else pendingRef.current.delete(id)
    setPending(new Set(pendingRef.current))
  }

  const handleClaim = async (task: InboxTask) => {
    if (pendingRef.current.has(task.assignmentId)) return
    setClaimPending(task.assignmentId, true)
    try {
      await claimTask(task)
    } finally {
      setClaimPending(task.assignmentId, false)
    }
  }

  const claimTask = async (task: InboxTask) => {
    try {
      await api.claim(task.assignmentId)
    } catch (err) {
      show(isRaceLoss(err) ? 'Task no longer available' : GENERIC_ERROR_COPY)
      refresh().catch(() => {})
      return
    }
    // The work view renders panes from the live snapshot — pull it before focusing,
    // otherwise the new tab may not exist yet and the operator would see the inbox
    // flash until SSE/poll deliver it. A failed refresh still opens: the view falls
    // back to the inbox until the pane arrives on its own.
    await refresh().catch(() => {})
    onOpenTask(task)
  }

  const handleRelease = async (task: InboxTask) => {
    try {
      await api.release(task.assignmentId)
    } catch (err) {
      show(isRaceLoss(err) ? 'Could not release' : GENERIC_ERROR_COPY)
      refresh().catch(() => {})
      return
    }
    clearDraft(task.assignmentId)
    onReleased?.(task)
    refresh().catch(() => {})
  }

  return (
    <Root className="inbox">
      <div className="inbox-toolbar">
        <input
          type="search"
          id="inbox-filter"
          className="inbox-filter"
          aria-keyshortcuts="/"
          aria-label={FILTER_LABEL}
          placeholder={FILTER_LABEL}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <section className="inbox-section" aria-labelledby="inbox-heading">
        <div className="inbox-section-head">
          {/* Focus target when the last claim is submitted (spec §5.6 item 5). Its name stays
              exactly "My tasks" — the count is a sibling (P1d-R1). */}
          <h2 id="inbox-heading" tabIndex={-1}>
            My tasks
          </h2>
          <span className="inbox-count">{countText(claims.length, myClaims.length)}</span>
        </div>
        {claims.length === 0 ? (
          <p className="inbox-empty">
            {myClaims.length > 0 ? noMatch : 'You have no claimed tasks. Claim one from Available.'}
          </p>
        ) : (
          <ul className="inbox-list">
            {claims.map((task) => (
              <TaskRow key={task.assignmentId} task={task} now={now} onOpen={task.paused ? undefined : () => onOpenTask(task)}>
                <ReleaseButton
                  typedCount={draftCount(task.assignmentId)}
                  asking={askingId === task.assignmentId}
                  onAskingChange={(a) => setAskingId(a ? task.assignmentId : null)}
                  disabled={offline}
                  onRelease={() => handleRelease(task)}
                />
              </TaskRow>
            ))}
          </ul>
        )}
      </section>

      <section className="inbox-section" aria-labelledby="inbox-available-heading">
        <div className="inbox-section-head">
          <h2 id="inbox-available-heading">Available</h2>
          <span className="inbox-count">{countText(available.length, offers.length)}</span>
        </div>
        {available.length === 0 ? (
          <p className="inbox-empty">{offers.length > 0 ? noMatch : 'Nothing is waiting for an operator right now.'}</p>
        ) : (
          <ul className="inbox-list">
            {available.map((task) => (
              <TaskRow key={task.assignmentId} task={task} now={now}>
                <button type="button" className="inbox-claim" disabled={offline || pending.has(task.assignmentId)} onClick={() => handleClaim(task)}>
                  Claim
                </button>
              </TaskRow>
            ))}
          </ul>
        )}
      </section>
      <WaitingSection waiting={snapshot?.waiting ?? []} offline={offline} refresh={refresh} />
    </Root>
  )
}
