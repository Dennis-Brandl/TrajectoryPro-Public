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
//
// The Workflows tab (spec 2026-08-19 §3.2): instance picker → breadcrumb →
// live diagram → legend. Selection and the drill stack live HERE; data fetching
// lives in useWorkflowDiagrams; drawing lives in WorkflowGraph. Tap semantics
// (§3.4): tooltip first, Open only from the tooltip (touch-slip safety); a
// WORKFLOW PROXY with a resolvable child drills down instead.
import { useEffect, useMemo, useState } from 'react'
import { useWorkflowDiagrams } from '../../workflows-data'
import { WorkflowGraph } from './WorkflowGraph'
import { GateTimerText } from '../../inbox/GateTimerText'
import { ContinueNowControl } from '../../inbox/ContinueNowControl'
import { colorFor, findSpecByOid, glyphFor, humaniseState, LEGEND, resolveDisplayState } from './state'
import type { PilotLiveStep, PilotRuntimeWorkflow, DiagramStep, InboxTask } from '../../api/types'

export interface WorkflowsScreenProps {
  wcId: string
  active: boolean
  online: boolean
  focusedTask: InboxTask | null
  onOpenTask(assignmentId: string): void
  onOpenInbox(): void
  onListCount(n: number): void
}

interface TooltipState {
  step: DiagramStep
  anchor: { x: number; y: number }
  noChild?: boolean
}

/** Selection priority shared by the initial default and deleted-instance recovery
 *  (spec §3.2): focused pane's instance → first mine → first listed. */
function pickDefault(list: PilotRuntimeWorkflow[], focusedTask: InboxTask | null): PilotRuntimeWorkflow | null {
  const byFocus = focusedTask ? list.find((w) => w.id === focusedTask.instanceId) : undefined
  const byMine = list.find((w) => w.mine)
  return byFocus ?? byMine ?? list[0] ?? null
}

function holderLine(entry: PilotLiveStep | undefined): string | null {
  const a = entry?.assignment
  if (!a) return null
  if (a.mine) return a.status === 'claimed' ? 'Yours' : 'Offered to you'
  if (a.status === 'claimed') return a.claimant ? `Claimed by ${a.claimant.displayName}` : 'Claimed'
  return 'Offered'
}

export function WorkflowsScreen({ wcId, active, online, focusedTask, onOpenTask, onOpenInbox, onListCount }: WorkflowsScreenProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drill, setDrill] = useState<string[]>([])          // child spec oids, root first
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const { list, diagram, live, unavailable } = useWorkflowDiagrams(wcId, active, online, selectedId)

  // Spec P0 (audit 3 §3): when the context pane changes — the operator worked on a
  // different task and came back — show THAT task's runtime. Keyed on assignmentId,
  // not object identity: every snapshot refresh hands over a new object for the
  // same pane, and that must not undo a runtime the operator picked by hand. A
  // render-phase adjustment (the house "adjust state when a prop changes" pattern),
  // so the old runtime's diagram never paints for a frame. A pane that has closed
  // (key → null) keeps the current selection. Only while the tab is up: this
  // screen stays mounted behind every pane, and selecting would fetch a diagram
  // on each pane switch; the change is noticed when the tab next opens.
  const focusKey = focusedTask?.assignmentId ?? null
  const [seenFocusKey, setSeenFocusKey] = useState(focusKey)
  if (active && seenFocusKey !== focusKey) {
    setSeenFocusKey(focusKey)
    if (focusedTask && focusedTask.instanceId !== selectedId) {
      setSelectedId(focusedTask.instanceId)
      setDrill([])
      setTooltip(null)
    }
  }

  useEffect(() => { if (list) onListCount(list.length) }, [list, onListCount])

  // Default selection (spec §3.2): focused pane's instance → first mine → first.
  // Fires only while nothing is selected; a selection that left the list is KEPT
  // (its terminal diagram stays up until the operator taps another chip).
  useEffect(() => {
    if (selectedId !== null || !list || list.length === 0) return
    setSelectedId(pickDefault(list, focusedTask)!.id)
  }, [selectedId, list, focusedTask])

  // Deleted-instance recovery: unavailable (403/404) AND gone from the list means the
  // instance was hard-deleted (or archived) — parking on the alert would strand the
  // operator behind their own CM cleanup. Move to the next running workflow with the
  // default priority, or clear back to the empty state when nothing is running. A
  // selection that is unavailable but STILL listed keeps the alert: the list claims it
  // exists, so auto-switching would fight the operator, and the next poll settles the race.
  useEffect(() => {
    if (!unavailable || selectedId === null || list === null) return
    if (list.some((w) => w.id === selectedId)) return
    const next = pickDefault(list, focusedTask)
    setSelectedId(next ? next.id : null)
    setDrill([])
    setTooltip(null)
  }, [unavailable, selectedId, list, focusedTask])

  const selectInstance = (id: string) => {
    setSelectedId(id)
    setDrill([])
    setTooltip(null)
  }

  const level = useMemo(() => {
    if (!diagram) return null
    const top = drill[drill.length - 1]
    return top ? findSpecByOid(diagram.root, top) ?? diagram.root : diagram.root
  }, [diagram, drill])

  const states = useMemo(
    () => (level ? resolveDisplayState(level, live?.steps ?? {}) : new Map<string, string>()),
    [level, live],
  )
  const mineOids = useMemo(
    () => new Set(Object.entries(live?.steps ?? {}).filter(([, s]) => s.assignment?.mine).map(([oid]) => oid)),
    [live],
  )

  const onStepTap = (step: DiagramStep, anchor: { x: number; y: number }) => {
    if (step.stepType === 'WORKFLOW PROXY') {
      const resolvable = step.childSpecOid && diagram && findSpecByOid(diagram.root, step.childSpecOid)
      if (resolvable) {
        setDrill((d) => [...d, step.childSpecOid!])
        setTooltip(null)
        return
      }
      setTooltip({ step, anchor, noChild: true })
      return
    }
    setTooltip({ step, anchor })
  }

  const selected = list?.find((w) => w.id === selectedId)
  const entry = tooltip ? live?.steps[tooltip.step.oid] : undefined
  const holder = tooltip ? holderLine(entry) : null
  const openable = entry?.assignment?.mine ? entry.assignment : null
  const childHint = tooltip && live?.childActive[tooltip.step.oid] && diagram
    ? findSpecByOid(diagram.root, live.childActive[tooltip.step.oid]!)?.name ?? null
    : null
  // GATE follow-up 8c: an ARMED gate names the ACTION PROXY it controls (a sibling at this level).
  const armed = tooltip?.step.stepType === 'GATE' ? entry?.armedGate ?? null : null
  // stopSent is an attempt marker the engine burns BEFORE any send attempt (gate.ts:88, §6.4) —
  // it never re-attempts, but several branches only log a WARNING instead of sending. So the
  // copy says "requested", never "sent" (which would claim delivery the engine can't promise).
  const armedLine = armed && level
    ? `Controls ${level.steps.find((s) => s.oid === armed.predecessorOid)?.name ?? armed.predecessorOid}`
      + (armed.stopSent ? ' · open, STOP requested' : armed.open ? ' · open, waiting for it to finish' : ' · evaluating')
    : null

  return (
    <main className="wf-screen">
      {!online && <p role="status">Offline — showing last known state</p>}

      {list !== null && list.length === 0 && <p>No running workflows at this work center.</p>}

      {list !== null && list.length > 0 && (
        <div role="listbox" aria-label="Running workflows" className="wf-picker">
          {list.map((w) => (
            <button
              key={w.id}
              type="button"
              role="option"
              aria-selected={w.id === selectedId}
              className="wf-chip"
              onClick={() => selectInstance(w.id)}
            >
              {w.runtimeLabel} · {w.masterName} v{w.masterVersion}
              <span className="wf-chip-status">{w.status}</span>
              {w.mine && <span className="wf-chip-mine" title="Includes your task" aria-label="includes your task">●</span>}
            </button>
          ))}
        </div>
      )}

      {selectedId && unavailable && <p role="alert">This workflow is no longer available.</p>}

      {/* Selected instance gone from the list (terminal): its status still shows via live.status. */}
      {selectedId && !selected && live && !unavailable && (
        <p role="status">{diagram?.runtimeLabel ?? '?'} — {live.status}</p>
      )}

      {drill.length > 0 && diagram && (
        <nav aria-label="Workflow level" className="wf-crumbs">
          <button type="button" onClick={() => setDrill([])}>{diagram.runtimeLabel} {diagram.masterName}</button>
          {drill.map((oid, i) => (
            <button
              key={oid}
              type="button"
              disabled={i === drill.length - 1}
              onClick={() => setDrill(drill.slice(0, i + 1))}
            >
              › {findSpecByOid(diagram.root, oid)?.name ?? oid}
            </button>
          ))}
        </nav>
      )}

      {level && (
        <div className="wf-graph-wrap">
          <WorkflowGraph
            spec={level}
            states={states}
            mineOids={mineOids}
            highlightedStepOid={focusedTask && focusedTask.instanceId === selectedId ? focusedTask.stepOid : null}
            resetKey={`${selectedId}:${level.oid}`}
            onStepTap={onStepTap}
          />
          {tooltip && (
            <div className="wf-tooltip" style={{ left: tooltip.anchor.x, top: tooltip.anchor.y }}>
              <div className="wf-tooltip-name">{tooltip.step.name}</div>
              <div className="wf-tooltip-meta">{tooltip.step.stepType} · <span>{humaniseState(states.get(tooltip.step.oid) ?? 'IDLE')}</span></div>
              {holder && <div className="wf-tooltip-meta">{holder}</div>}
              {armedLine && <div className="wf-tooltip-meta">{armedLine}</div>}
              {entry?.gateTimer && <div className="wf-tooltip-meta"><GateTimerText timer={entry.gateTimer} /></div>}
              {childHint && <div className="wf-tooltip-meta">Running: {childHint}</div>}
              {tooltip.noChild && <div className="wf-tooltip-meta">Child workflow not available</div>}
              {entry?.error && <div className="wf-tooltip-error">{entry.error}</div>}
              <div className="wf-tooltip-actions">
                {entry?.gateTimer && entry.stepInstanceId && selectedId && (
                  <ContinueNowControl instanceId={selectedId} stepInstanceId={entry.stepInstanceId} stepName={tooltip.step.name}
                    disabled={!online || live?.status !== 'running'}
                    disabledReason={live?.status !== 'running' ? 'Resume the workflow first' : 'Offline'}
                    onDone={() => setTooltip(null)} />
                )}
                {openable && (
                  <button
                    type="button"
                    onClick={() => {
                      setTooltip(null)
                      if (openable.status === 'claimed') onOpenTask(openable.id)
                      else onOpenInbox()
                    }}
                  >
                    Open
                  </button>
                )}
                <button type="button" onClick={() => setTooltip(null)} aria-label="Close">×</button>
              </div>
            </div>
          )}
        </div>
      )}

      {level && (
        <ul className="wf-legend" aria-label="Legend">
          {LEGEND.map(([state, word]) => (
            <li key={state}>
              <span className="wf-swatch" style={{ background: colorFor(state).fill }} aria-hidden="true" />{' '}
              <span className="wf-legend-glyph" aria-hidden="true">{glyphFor(state)}</span> {word}
            </li>
          ))}
          <li>
            <span className="wf-swatch wf-swatch-ring" aria-hidden="true" /> Your task
          </li>
        </ul>
      )}
    </main>
  )
}
