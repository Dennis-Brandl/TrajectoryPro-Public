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

import { useMemo, useRef, useState } from 'react'
import { Button } from '@mission/ui'
import { Play, RefreshCw } from 'lucide-react'
import {
  applyCleanupFindings,
  streamCleanupScan,
  type ApplyResponse,
  type StreamHandle,
} from '@/lib/admin/cleanupClient'
import type { Finding, ScanEvent, ScanReportSummary } from '../../server/admin/cleanup/types'
import { FindingRow } from './cleanup/FindingRow'
import { DestructiveConfirmDialog } from './cleanup/DestructiveConfirmDialog'

type Phase = 'idle' | 'scanning' | 'results' | 'applying' | 'complete'

interface Progress {
  librariesDone: number
  librariesTotal: number
  specsDone: number
  specsTotal: number
  currentLibraryName: string
  currentUserEmail: string
}

export function CleanupTab() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState<Progress | null>(null)
  const [findings, setFindings] = useState<Finding[]>([])
  const [summary, setSummary] = useState<ScanReportSummary | null>(null)
  const [scanId, setScanId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [applyResponse, setApplyResponse] = useState<ApplyResponse | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const streamRef = useRef<StreamHandle | null>(null)
  const [driftFilter, setDriftFilter] = useState<Finding['driftType'] | null>(null)
  const [collapsedLibraries, setCollapsedLibraries] = useState<Set<string>>(new Set())

  const startScan = () => {
    setPhase('scanning')
    setProgress(null)
    setFindings([])
    setSummary(null)
    setScanId(null)
    setSelected(new Set())
    setApplyResponse(null)
    setError(null)

    streamRef.current = streamCleanupScan((evt: ScanEvent) => {
      if (evt.type === 'start') {
        setProgress({
          librariesDone: 0,
          librariesTotal: evt.totalLibraries,
          specsDone: 0,
          specsTotal: evt.totalSpecs,
          currentLibraryName: '',
          currentUserEmail: '',
        })
      } else if (evt.type === 'progress') {
        setProgress({
          librariesDone: evt.librariesDone,
          librariesTotal: evt.librariesTotal,
          specsDone: evt.specsDone,
          specsTotal: evt.specsTotal,
          currentLibraryName: evt.currentLibraryName,
          currentUserEmail: evt.currentUserEmail,
        })
      } else if (evt.type === 'result') {
        setScanId(evt.scanId)
        setFindings(evt.findings)
        setSummary(evt.summary)
        // Pre-select safe findings (D3, D4)
        const initial = new Set(
          evt.findings.filter((f) => f.driftType === 'D3' || f.driftType === 'D4').map((f) => f.id),
        )
        setSelected(initial)
        setPhase('results')
      } else if (evt.type === 'error') {
        setError(evt.message)
        setPhase('idle')
      }
    })
  }

  const toggle = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const destructiveSelected = useMemo(() => {
    const byId = new Map(findings.map((f) => [f.id, f]))
    const orphans: Finding[] = []
    const reparents: Finding[] = []
    for (const id of selected) {
      const f = byId.get(id)
      if (!f) continue
      if (f.driftType === 'D1') orphans.push(f)
      else if (f.driftType === 'D2') reparents.push(f)
    }
    const orphanDescendantsCount = orphans.reduce((acc, f) => acc + (f.driftType === 'D1' ? f.descendantCount : 0), 0)
    return { orphanCount: orphans.length, orphanDescendantsCount, reparentCount: reparents.length }
  }, [findings, selected])

  const startApply = () => {
    if (destructiveSelected.orphanCount + destructiveSelected.reparentCount > 0) {
      setConfirmOpen(true)
    } else {
      void doApply()
    }
  }

  const doApply = async () => {
    if (!scanId) return
    setConfirmOpen(false)
    setPhase('applying')
    try {
      const res = await applyCleanupFindings(scanId, [...selected])
      setApplyResponse(res)
      setPhase('complete')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('results')
    }
  }

  const groupedByLibrary = useMemo(() => {
    const map = new Map<string, { libraryName: string; userEmail: string; items: Finding[] }>()
    for (const f of findings) {
      if (driftFilter && f.driftType !== driftFilter) continue
      let g = map.get(f.libraryId)
      if (!g) {
        g = { libraryName: f.libraryName, userEmail: f.userEmail, items: [] }
        map.set(f.libraryId, g)
      }
      g.items.push(f)
    }
    return [...map.entries()].map(([libraryId, v]) => ({ libraryId, ...v }))
  }, [findings, driftFilter])

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Cleanup</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Detect and reconcile drift between workflow diagrams and the database across every library and user.
          </p>
        </div>
        <Button size="sm" onClick={startScan} disabled={phase === 'scanning' || phase === 'applying'}>
          {phase === 'scanning' || phase === 'applying' ? (
            <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />
          ) : (
            <Play className="h-4 w-4 mr-1.5" />
          )}
          {phase === 'results' || phase === 'complete' ? 'Rescan' : 'Run Cleanup Scan'}
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-3">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {phase === 'scanning' && progress && (
        <div className="rounded-md border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 p-3">
          <p className="text-sm text-blue-700 dark:text-blue-300">
            Scanning{' '}
            {progress.currentLibraryName
              ? `library "${progress.currentLibraryName}" (${progress.currentUserEmail})`
              : ''}{' '}
            — {progress.librariesDone} / {progress.librariesTotal} libraries · {progress.specsDone} /{' '}
            {progress.specsTotal} specs
          </p>
        </div>
      )}

      {(phase === 'results' || phase === 'complete') && summary && (
        <>
          <div className="text-sm text-slate-600 dark:text-slate-300">
            <strong>{findings.length} total</strong> · {findings.length - summary.totalReportOnly} fixable ·{' '}
            {summary.totalReportOnly} report-only
          </div>

          <div className="flex flex-wrap gap-2">
            {(['D1', 'D2', 'D3', 'D4', 'D5', 'D6'] as Finding['driftType'][]).map((t) => {
              const count = summary.byType[t]
              const active = driftFilter === t
              return (
                <button
                  key={t}
                  type="button"
                  aria-label={`filter ${t}`}
                  onClick={() => setDriftFilter(active ? null : t)}
                  className={`rounded-full px-2.5 py-1 text-xs border ${
                    active
                      ? 'bg-blue-600 text-white border-blue-600'
                      : count === 0
                        ? 'bg-slate-50 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border-slate-200 dark:border-slate-700'
                        : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500'
                  }`}
                  disabled={count === 0}
                >
                  {t}: {count}
                </button>
              )
            })}
            {driftFilter && (
              <button
                type="button"
                onClick={() => setDriftFilter(null)}
                className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 px-2"
              >
                Clear filter
              </button>
            )}
          </div>

          <div className="border border-slate-200 dark:border-slate-700 rounded-md overflow-hidden">
            {groupedByLibrary.map((group) => {
              const collapsed = collapsedLibraries.has(group.libraryId)
              return (
                <div key={group.libraryId}>
                  <button
                    type="button"
                    aria-label={`toggle library ${group.libraryName}`}
                    onClick={() =>
                      setCollapsedLibraries((prev) => {
                        const next = new Set(prev)
                        if (next.has(group.libraryId)) next.delete(group.libraryId)
                        else next.add(group.libraryId)
                        return next
                      })
                    }
                    className="w-full text-left px-3 py-2 bg-slate-100 dark:bg-slate-800 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center gap-2"
                  >
                    <span className="inline-block w-3">{collapsed ? '▸' : '▾'}</span>
                    {group.libraryName}{' '}
                    <span className="text-slate-500 dark:text-slate-400 font-normal">({group.userEmail})</span>
                    <span className="text-slate-500 dark:text-slate-400 font-normal">
                      — {group.items.length} finding{group.items.length === 1 ? '' : 's'}
                    </span>
                  </button>
                  {!collapsed &&
                    group.items.map((f) => (
                      <FindingRow key={f.id} finding={f} checked={selected.has(f.id)} onToggle={toggle} />
                    ))}
                </div>
              )
            })}
          </div>
        </>
      )}

      {phase === 'applying' && (
        <div className="rounded-md border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 p-3">
          <p className="text-sm text-blue-700 dark:text-blue-300">Applying fixes...</p>
        </div>
      )}

      {phase === 'complete' && applyResponse && (
        <div className="rounded-md border border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950/40 p-3">
          <p className="text-sm text-green-800 dark:text-green-300">
            Cleanup: {applyResponse.applied} applied, {applyResponse.skipped} skipped, {applyResponse.failed} failed
          </p>
          {applyResponse.results.filter((r) => r.result !== 'applied').length > 0 && (
            <details className="mt-2 text-xs text-slate-700 dark:text-slate-300">
              <summary>View details</summary>
              <ul className="mt-2 space-y-1 font-mono">
                {applyResponse.results.map((r) => (
                  <li key={r.findingId}>
                    {r.findingId}: {r.result}
                    {r.message ? ` — ${r.message}` : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {phase === 'results' && findings.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 px-6 py-3 flex items-center justify-end gap-3 shadow-md">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setSelected(() => {
                const next = new Set<string>()
                for (const f of findings) if (f.driftType === 'D3' || f.driftType === 'D4') next.add(f.id)
                return next
              })
            }
          >
            Select all safe
          </Button>
          <span className="text-sm text-slate-600 dark:text-slate-300">{selected.size} selected</span>
          <Button size="sm" onClick={startApply} disabled={selected.size === 0}>
            Apply selected fixes ({selected.size})
          </Button>
        </div>
      )}

      <DestructiveConfirmDialog
        open={confirmOpen}
        orphanCount={destructiveSelected.orphanCount}
        orphanDescendantsCount={destructiveSelected.orphanDescendantsCount}
        reparentCount={destructiveSelected.reparentCount}
        onConfirm={doApply}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
