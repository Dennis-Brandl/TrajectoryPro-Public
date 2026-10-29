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
import { Component, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type TouchEvent } from 'react'
import { InboxScreen } from './InboxScreen'
import { TaskScreen } from './TaskScreen'
import { WorkflowsScreen } from './workflows/WorkflowsScreen'
import { useToast } from '../toast'
import { useSession } from '../session'
import { taskLabel } from '../task-label'
import { useAppTitle } from '../frame/app-title'
import { ClaimTabContent, claimTabName } from '../frame/ClaimTabContent'
import { OpenClaimsSheet } from '../frame/OpenClaimsSheet'
import { ContextBar } from '../frame/ContextBar'
import { instanceStripe } from '../frame/runtime-id'
import { clearDraft } from '../task/drafts'
import { useFormSurface } from '../theme/form-surface'
import { useShortcut } from '../frame/shortcuts'
import { ShortcutsSheet } from '../frame/ShortcutsSheet'
import { useMediaQuery } from '../frame/useMediaQuery'
import type { PilotLayout } from '../theme/prefs'
import type { InboxSnapshot, InboxTask } from '../api/types'

// Reserved focus id for the fixed Workflows tab (spec §3.2): pane ids are uuids
// from the server, so this can never collide with a real assignmentId.
const WORKFLOWS_TAB_ID = 'workflows'

// Spec §5.6 item 4: how long after a Submit a follow-on step for the same runtime (the
// auto-claim chain) may still take focus — the refresh nudge normally lands well inside it.
const FOLLOW_ON_MS = 3_000

// Spec §16: Workstation splits only where there is room; below this it is Standard.
export const WORKSTATION_QUERY = '(min-width: 1280px)'

export interface WorkViewProps {
  wcId: string
  /** Shown in the context bar (spec §5.3). */
  wcName: string
  snapshot: InboxSnapshot | null
  // true while `snapshot` is a localStorage cache seed not yet confirmed by a live
  // fetch. The live-list reactions key off this — they must never fire off cached
  // data (declared now, consumed by the snapshot-diff effect).
  stale: boolean
  // Two offline flags on purpose: useInbox keeps its own online/offline listener
  // (inbox claim/release disabling), App keeps another (banner + task actions) —
  // same browser events, deliberately independent modules.
  inboxOffline: boolean
  offline: boolean
  refresh(): Promise<void>
  /** Spec §16 per-device layout; Workstation splits at ≥ 1280 px. */
  layout?: PilotLayout
}

// Stable tab order: the server already sorts myClaims by claimedAt ascending, but
// parallel auto-claimed branches share one reconcile clock — the assignmentId
// tie-break keeps tabs from swapping places between snapshot refreshes.
function paneList(claims: InboxTask[], closedIds: ReadonlySet<string>): InboxTask[] {
  return claims
    .filter((t) => !closedIds.has(t.assignmentId))
    .sort(
      (a, b) =>
        (a.claimedAt ?? '').localeCompare(b.claimedAt ?? '') ||
        a.assignmentId.localeCompare(b.assignmentId),
    )
}

interface TaskErrorBoundaryProps {
  onReset(): void
  children: ReactNode
}

interface TaskErrorBoundaryState {
  hasError: boolean
}

// Backstop for TaskScreen's host contract: `asFormDocument`'s guard (TaskScreen.tsx)
// only checks for a `sections` array, so a shallow-malformed form_document (e.g. a
// section with no `rows`) can still throw deep inside seedDefaults/computeValidation.
// React error boundaries must be class components — there is no hook equivalent — so
// this stays small and local instead of pulling in a general-purpose library. One
// boundary per PANE: a crash in one task's document must not take down the others.
class TaskErrorBoundary extends Component<TaskErrorBoundaryProps, TaskErrorBoundaryState> {
  state: TaskErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): TaskErrorBoundaryState {
    return { hasError: true }
  }

  private handleBack = () => {
    this.setState({ hasError: false })
    this.props.onReset()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div role="alert">
          <p>Something went wrong showing this task.</p>
          <button type="button" onClick={this.handleBack}>
            Back to inbox
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// Multi-step work view (auto-claim spec §6): the inbox plus one tab per claim, all
// panes kept mounted so a half-typed form survives tab switches and snapshot
// refreshes. Each pane's task object comes from the LIVE snapshot (keyed by
// assignmentId) — the old screen model froze the task at claim time, so a pause,
// a force-release, or fresher step data never reached an open task.
export function WorkView({ wcId, wcName, snapshot: incoming, stale, inboxOffline, offline, refresh, layout = 'standard' }: WorkViewProps) {
  // On a work-center switch this view remounts while useInbox still holds the previous
  // work center's (fresh) snapshot for a render. Using it would baseline the diff on the
  // wrong claims, so the first real snapshot would read every one of them as taken away —
  // false "No longer yours" toasts and deleted drafts (P1c final review). Ignore it.
  const snapshot = incoming && incoming.workCenterId === wcId ? incoming : null
  const { show } = useToast()
  const { user } = useSession()
  // Spec §14: one probe for every pane — it follows light/dark and theme changes.
  const surfaceColor = useFormSurface()
  const wide = useMediaQuery(WORKSTATION_QUERY)
  const split = layout === 'workstation' && wide
  // null = the inbox tab. May briefly name an assignment the snapshot does not list
  // yet (a just-claimed offer racing its refresh): rendering then falls back to the
  // inbox, and the pane takes over as soon as it exists — so the raw value is kept.
  // WORKFLOWS_TAB_ID is a third valid value — it never appears in `panes`, so it
  // is checked for explicitly below instead of via `panes.some(...)`.
  const [focusedId, setFocusedId] = useState<string | null>(null)
  // Panes closed locally (submit, lost race) are hidden immediately; the server
  // catches up on the next snapshot. Entries are pruned once the server agrees.
  const [closedIds, setClosedIds] = useState<ReadonlySet<string>>(() => new Set())
  // Fed by WorkflowsScreen's onListCount — shown as a badge on the Workflows tab.
  const [wfCount, setWfCount] = useState(0)
  // The tablet "N open" claims sheet (spec §5.2).
  const [sheetOpen, setSheetOpen] = useState(false)
  // The `?` shortcuts list (spec §15).
  const [helpOpen, setHelpOpen] = useState(false)
  // Bumped by `/`: focus moves to the filter after the inbox is on screen.
  const [filterRequest, setFilterRequest] = useState(0)
  // Inbox UI state lives here, not in InboxScreen: a layout switch moves the inbox between
  // the tab panel and the Workstation column, which remounts it.
  const [inboxQuery, setInboxQuery] = useState('')
  const [inboxAskingId, setInboxAskingId] = useState<string | null>(null)
  // A question whose claim is gone (submitted, released, taken away) is over — otherwise a
  // re-claim of the same assignment would bring it back already asking.
  if (inboxAskingId !== null && snapshot && !snapshot.myClaims.some((t) => t.assignmentId === inboxAskingId)) {
    setInboxAskingId(null)
  }

  const offers = snapshot?.offers ?? []
  const panes = paneList(snapshot?.myClaims ?? [], closedIds)
  const focused =
    focusedId === WORKFLOWS_TAB_ID || panes.some((p) => p.assignmentId === focusedId)
      ? focusedId
      : null

  // The pane the operator was last on (audit 3 §3). The Workflows tab is not a
  // pane, so while it is up `focused` names no task — it needs the one the operator
  // came from. Render-phase adjustment (house pattern) so the Workflows tab never
  // renders a frame with stale context. The inbox does not clear it: inbox →
  // Workflows still means "the task I was just on".
  const [lastPaneId, setLastPaneId] = useState<string | null>(null)
  if (focused !== null && focused !== WORKFLOWS_TAB_ID && focused !== lastPaneId) {
    setLastPaneId(focused)
  }
  const contextPane = panes.find((p) => p.assignmentId === (focused === WORKFLOWS_TAB_ID || focused === null ? lastPaneId : focused)) ?? null

  // Spec §5.6: after a Submit (or Release, or a lost race) focus moves on; `arrival`
  // names where it went (null = the inbox), so that pane shows the "Now on" cue and its
  // heading takes focus. Moving anywhere else ends the cue (render-phase adjustment).
  const [arrival, setArrival] = useState<{ id: string | null } | null>(null)
  if (arrival && arrival.id !== focused) setArrival(null)
  const arrivalRef = useRef(arrival)
  arrivalRef.current = arrival
  const followOnRef = useRef<{ instanceId: string; until: number } | null>(null)

  useEffect(() => {
    if (!arrival) return
    // Never into the next form: keystrokes typed during the switch land nowhere (§5.6 item 3).
    document.getElementById(arrival.id ? `task-heading-${arrival.id}` : 'inbox-heading')?.focus()
  }, [arrival])

  // Spec P0: two Pilot windows (two monitors, a kiosk plus a laptop) must be
  // tellable apart in the taskbar, so the title names the task in front.
  const focusedPane = panes.find((p) => p.assignmentId === focused)
  const appTitle = useAppTitle()
  const title = focusedPane
    ? `${taskLabel(focusedPane)} — ${appTitle}`
    : `${focused === WORKFLOWS_TAB_ID ? 'Workflows' : 'Inbox'} — ${appTitle}`
  useEffect(() => {
    document.title = title
  }, [title])
  // A ref, so the unmount reset uses the title current at unmount, not the first render's.
  const appTitleRef = useRef(appTitle)
  appTitleRef.current = appTitle
  useEffect(() => () => {
    document.title = appTitleRef.current
  }, [])

  // Navigation order for the arrow buttons (and the swipe/keyboard handlers):
  // the inbox sits at position 0, the fixed Workflows tab at 1, then the panes.
  const order: Array<string | null> = [null, WORKFLOWS_TAB_ID, ...panes.map((t) => t.assignmentId)]
  const pos = order.indexOf(focused)
  const go = (i: number) => {
    setFocusedId(order[Math.max(0, Math.min(order.length - 1, i))] ?? null)
  }

  // Spec §15 / P4-R1: Alt+1..9 = claim tab 1..9, Alt+0 = the inbox.
  useShortcut('tab', ({ index }) => {
    if (index === 0) setFocusedId(null)
    else {
      const pane = panes[index - 1]
      if (pane) setFocusedId(pane.assignmentId)
    }
  })
  useShortcut('filter', () => {
    // In Workstation the inbox is already on screen beside the task (P4-R6).
    if (!split) setFocusedId(null)
    setFilterRequest((n) => n + 1)
  })
  useShortcut('help', () => setHelpOpen(true))
  useEffect(() => {
    if (filterRequest > 0) document.getElementById('inbox-filter')?.focus()
  }, [filterRequest])

  // Touch swipe between tabs (the free Runtime's ActiveScreen gesture, minus the
  // carousel dependency): compare touch start/end, act only on decisively
  // horizontal moves so vertical form/list scrolling never switches tabs.
  const touchRef = useRef<{ x: number; y: number } | null>(null)
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0]
    touchRef.current = t ? { x: t.clientX, y: t.clientY } : null
  }
  const onTouchEnd = (e: TouchEvent) => {
    const start = touchRef.current
    touchRef.current = null
    const t = e.changedTouches[0]
    if (!start || !t) return
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    if (Math.abs(dx) < 48 || Math.abs(dx) < 2 * Math.abs(dy)) return
    go(pos + (dx < 0 ? 1 : -1)) // swipe left = next tab (carousel direction)
  }
  const onTablistKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    go(pos + (e.key === 'ArrowRight' ? 1 : -1))
  }

  // Submit success and a lost race both end a pane: hide it now, hand focus to the
  // next tab (else the previous one, else the inbox), and nudge a refresh so the
  // server truth — including any auto-claim-chained follow-on step — lands fast.
  const closePane = (id: string, followOn = false) => {
    const idx = panes.findIndex((p) => p.assignmentId === id)
    const closing = panes[idx]
    const rest = panes.filter((p) => p.assignmentId !== id)
    const next = rest[idx] ?? rest[idx - 1] ?? null
    setClosedIds((prev) => new Set(prev).add(id))
    setFocusedId(next ? next.assignmentId : null)
    setArrival({ id: next ? next.assignmentId : null })
    // P0 minor: a closed pane is never the Workflows tab's "task I was just on".
    if (lastPaneId === id) setLastPaneId(next ? next.assignmentId : null)
    followOnRef.current = followOn && closing ? { instanceId: closing.instanceId, until: Date.now() + FOLLOW_ON_MS } : null
    refresh().catch(() => {})
  }

  // ---- Live-list reactions ----------------------------------------------------
  // All of these run only between two FRESH snapshots: prevPanesRef stays null until
  // a live fetch has been seen once, so cache seeds and the login-restore snapshot
  // are silent baselines (no toast, no focus movement). Refs keep the effect keyed
  // on snapshot arrival alone — pane closes / focus changes between snapshots must
  // not re-trigger the diff. (StrictMode's dev double-invoke is safe: the second
  // run diffs a snapshot against itself.)
  const prevPanesRef = useRef<InboxTask[] | null>(null)
  const closedIdsRef = useRef(closedIds)
  closedIdsRef.current = closedIds
  const focusedIdRef = useRef(focusedId)
  focusedIdRef.current = focusedId

  useEffect(() => {
    if (!snapshot || stale) return
    const claims = snapshot.myClaims
    const closed = closedIdsRef.current

    // Tombstone pruning. A locally-closed pane stays suppressed only while the
    // server still lists it UNPAUSED (an in-flight pre-submit snapshot). Once it is
    // gone the tombstone has done its job; if it is listed PAUSED, the "race" 409
    // was really a pause landing mid-submit — the step is still ours, so the tab
    // must come back (as paused) instead of being suppressed forever. Decided FIRST
    // so the baseline below (and what's diffed as "current") reflects the same
    // pruned set the render will show — otherwise a resurfaced pane is invisible to
    // this run's own baseline and gets mis-diffed as "just arrived" (stealing focus
    // on the next poll) or, if removed before that poll, never toasted at all.
    let effectiveClosed = closed
    if (closed.size > 0) {
      const liveUnpaused = new Set(claims.filter((t) => !t.paused).map((t) => t.assignmentId))
      const kept = [...closed].filter((id) => liveUnpaused.has(id))
      if (kept.length !== closed.size) {
        effectiveClosed = new Set(kept)
        setClosedIds(effectiveClosed)
      }
    }

    const paneTasks = paneList(claims, effectiveClosed)
    const ids = paneTasks.map((t) => t.assignmentId)
    const prev = prevPanesRef.current
    prevPanesRef.current = paneTasks

    if (prev === null) return // baseline established; nothing to diff yet

    const prevIds = prev.map((t) => t.assignmentId)
    const currentFocus = focusedIdRef.current

    // Panes that vanished WITHOUT a local close were taken externally (a commander
    // force-release, a sign-out sweep on another terminal): say so — a silently
    // disappearing tab reads as the app eating the operator's work.
    for (const t of prev) {
      if (!ids.includes(t.assignmentId) && !closed.has(t.assignmentId)) {
        show(`No longer yours: ${taskLabel(t)}`)
        clearDraft(t.assignmentId)
      }
    }

    const added = ids.filter((id) => !prevIds.includes(id))
    // Spec §5.6 item 4: the auto-claim chain handed over the same runtime's next step right
    // after a Submit — prefer it over the neighbour the close picked, but only while the
    // operator has not started on that neighbour (the "Now on" cue is still up).
    const follow = followOnRef.current
    const followOn =
      follow && Date.now() <= follow.until && arrivalRef.current !== null
        ? paneTasks.find((t) => added.includes(t.assignmentId) && t.instanceId === follow.instanceId)
        : undefined

    if (followOn) {
      followOnRef.current = null
      setFocusedId(followOn.assignmentId)
      setArrival({ id: followOn.assignmentId })
    } else if (currentFocus !== null && currentFocus !== WORKFLOWS_TAB_ID && !ids.includes(currentFocus)) {
      // The focused pane was removed externally: hand focus to the nearest surviving
      // neighbour (after, else before, else inbox) — the same rule as a local close.
      // A focus id the previous snapshot never listed is a just-claimed pane still
      // in flight: leave it alone; the render fallback shows the inbox meanwhile.
      // WORKFLOWS_TAB_ID is excluded above: it is not a pane, so it can never be
      // "removed" — the operator studying the diagram must stay put.
      const idx = prevIds.indexOf(currentFocus)
      if (idx !== -1) {
        const after = prevIds.slice(idx + 1).find((id) => ids.includes(id))
        const before = prevIds.slice(0, idx).reverse().find((id) => ids.includes(id))
        setFocusedId(after ?? before ?? null)
      }
    } else if (currentFocus === null) {
      // A pane arriving while the operator sits on the inbox is the auto-claim chain
      // handing them their next step (their own claims focus explicitly via
      // onOpenTask) — follow it. New panes never steal focus from another pane.
      if (added.length > 0) setFocusedId(added[0] ?? null)
    }
    // `show` is deliberately not a dependency: useToast() returns a fresh object per
    // render that delegates to a module-level singleton — depending on it would run
    // this diff on every render.
  }, [snapshot, stale])

  const inbox = (
    <InboxScreen
      snapshot={snapshot}
      offline={inboxOffline}
      refresh={refresh}
      onOpenTask={(t) => setFocusedId(t.assignmentId)}
      onReleased={(t) => setClosedIds((prev) => new Set(prev).add(t.assignmentId))}
      query={inboxQuery}
      onQueryChange={setInboxQuery}
      releaseAskingId={inboxAskingId}
      onReleaseAskingChange={setInboxAskingId}
      inRail={split}
    />
  )

  return (
    <div className={split ? 'work-view work-view-split' : 'work-view'}>
      {/* Spec §16: one inbox only — in the rail when split, else in the Inbox tab's panel. */}
      {split && (
        <aside className="work-rail" aria-label="Inbox">
          {inbox}
        </aside>
      )}
      <div className="work-main">
        <nav className="work-tabs">
          <button
            type="button"
            className="work-tab-arrow"
            aria-label="Previous tab"
            disabled={pos <= 0}
            onClick={() => go(pos - 1)}
          >
            ←
          </button>
          <div role="tablist" aria-label="Open work" onKeyDown={onTablistKeyDown}>
            <button
              type="button"
              role="tab"
              id="tab-inbox"
              aria-selected={focused === null}
              aria-controls="panel-inbox"
              onClick={() => setFocusedId(null)}
            >
              Inbox{offers.length > 0 ? ` (${offers.length})` : ''}
            </button>
            <button
              type="button"
              role="tab"
              id="tab-workflows"
              aria-selected={focused === WORKFLOWS_TAB_ID}
              aria-controls="panel-workflows"
              onClick={() => setFocusedId(WORKFLOWS_TAB_ID)}
            >
              Workflows{wfCount > 0 ? ` (${wfCount})` : ''}
            </button>
            {panes.map((t) => (
              <button
                type="button"
                role="tab"
                key={t.assignmentId}
                id={`tab-${t.assignmentId}`}
                className="claim-tab"
                aria-label={claimTabName(t)}
                aria-selected={focused === t.assignmentId}
                aria-controls={`panel-${t.assignmentId}`}
                // Spec §5.2: one of six stripe colours per runtime, so two batches of the
                // same step read as different tabs at a glance.
                style={{ '--tab-stripe': `var(--pilot-instance-${instanceStripe(t.runtimeLabel)})` } as CSSProperties}
                onClick={() => setFocusedId(t.assignmentId)}
              >
                <ClaimTabContent task={t} />
              </button>
            ))}
          </div>
          {panes.length > 0 && (
            <button
              type="button"
              className="claims-open-btn"
              aria-haspopup="dialog"
              aria-expanded={sheetOpen}
              onClick={() => setSheetOpen(true)}
            >
              {panes.length} open
            </button>
          )}
          <button
            type="button"
            className="work-tab-arrow"
            aria-label="Next tab"
            disabled={pos >= order.length - 1}
            onClick={() => go(pos + 1)}
          >
            →
          </button>
        </nav>

        {/* Keyed per pane so a "Copied" from one task never shows on the next. */}
        {focusedPane && (
          <ContextBar
            key={focusedPane.assignmentId}
            task={focusedPane}
            wcName={wcName}
            arrived={arrival?.id === focusedPane.assignmentId}
          />
        )}

        <div className="work-panes" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <div id="panel-inbox" role="tabpanel" aria-labelledby="tab-inbox" hidden={focused !== null}>
            {split ? (
              <p className="work-rail-note">Your inbox is in the left column. Open a task there to work on it here.</p>
            ) : (
              inbox
            )}
          </div>

          <div id="panel-workflows" role="tabpanel" aria-labelledby="tab-workflows" hidden={focused !== WORKFLOWS_TAB_ID}>
            <WorkflowsScreen
              wcId={wcId}
              active={focused === WORKFLOWS_TAB_ID}
              online={!offline}
              focusedTask={contextPane}
              onOpenTask={(assignmentId) =>
                setFocusedId(panes.some((p) => p.assignmentId === assignmentId) ? assignmentId : null)
              }
              onOpenInbox={() => setFocusedId(null)}
              onListCount={setWfCount}
            />
          </div>

          {panes.map((t) => (
            <div
              key={t.assignmentId}
              id={`panel-${t.assignmentId}`}
              role="tabpanel"
              aria-labelledby={`tab-${t.assignmentId}`}
              hidden={focused !== t.assignmentId}
            >
              <TaskErrorBoundary onReset={() => setFocusedId(null)}>
                <TaskScreen
                  task={t}
                  active={focused === t.assignmentId}
                  me={user}
                  surfaceColor={surfaceColor}
                  // Spec §5.6 item 1: confirm what was submitted, by step AND runtime ID —
                  // focus is about to move to the next claim, so the operator needs to know
                  // the last one landed. A lost race goes through onError instead.
                  onDone={() => {
                    show(`Submitted ${taskLabel(t)}`, { tone: 'ok' })
                    closePane(t.assignmentId, true)
                  }}
                  arrived={arrival?.id === t.assignmentId}
                  onArrivalSeen={() => setArrival(null)}
                  // Same race-vs-transient split the old App handler had: a lost race
                  // (403/409) means this pane is dead — close it and move on. Anything
                  // else is transient, so the pane and its typed values stay put.
                  onError={(msg, kind) => {
                    show(msg)
                    if (kind === 'race') closePane(t.assignmentId)
                  }}
                  offline={offline}
                  onReleased={() => {
                    show(`Released ${taskLabel(t)}`)
                    closePane(t.assignmentId)
                  }}
                />
              </TaskErrorBoundary>
            </div>
          ))}
        </div>
      </div>

      {sheetOpen && panes.length > 0 && (
        <OpenClaimsSheet
          tasks={panes}
          focusedId={focused}
          onPick={(id) => {
            setSheetOpen(false)
            setFocusedId(id)
          }}
          onClose={() => setSheetOpen(false)}
        />
      )}

      {helpOpen && <ShortcutsSheet onClose={() => setHelpOpen(false)} />}
    </div>
  )
}
