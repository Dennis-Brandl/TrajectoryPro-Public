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

import { useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Button } from '@mission/ui'
import type { ImportPlan, ImportPlanRow } from '@/types/wflibx-import'
import { usePrincipal, principalHasRight } from '@/stores/principalStore'
import { useLibraryStore } from '@/stores/libraryStore'
import { isGlobalTeam } from '@/lib/global-team'
import { REFUSAL_LABEL, changedSinceExportDetail } from './import-report-summary'

interface Props {
  open: boolean
  plan: ImportPlan
  onCommit: (resolutions: Record<string, 'keep' | 'replace'>, teamId: string) => Promise<void> | void
  onCancel: () => void
}

const ENTITY_ORDER = ['workflow', 'step', 'environment', 'action'] as const

export function WorkflowLibraryImportDialog({ open, plan, onCommit, onCancel }: Props) {
  const [resolutions, setResolutions] = useState<Record<string, 'keep' | 'replace'>>({})

  // Target team for the created libraries (mirrors CreateLibraryDialog): teams the
  // user can create workflow libraries in, defaulting to the sidebar's selection,
  // hidden when only one is eligible. The server re-checks per category at commit.
  const principal = usePrincipal()
  const selectedTeamId = useLibraryStore((s) => s.selectedTeamId)
  const eligibleTeams = useMemo(
    // Never GLOBAL: workflow libraries cannot belong to it (spec 2026-10-12 §4.2).
    () =>
      (principal?.teams ?? []).filter(
        (t) => !isGlobalTeam(t.id) && principalHasRight(principal, t.id, 'workflow:library.create'),
      ),
    [principal],
  )
  const defaultTeamId =
    selectedTeamId && eligibleTeams.some((t) => t.id === selectedTeamId) ? selectedTeamId : (eligibleTeams[0]?.id ?? '')
  const [teamId, setTeamId] = useState(defaultTeamId)
  const effectiveTeamId = eligibleTeams.some((t) => t.id === teamId) ? teamId : defaultTeamId

  const sortedRows = useMemo(() => {
    return [...plan.rows].sort((a, b) => {
      const ai = ENTITY_ORDER.indexOf(a.entityType as (typeof ENTITY_ORDER)[number])
      const bi = ENTITY_ORDER.indexOf(b.entityType as (typeof ENTITY_ORDER)[number])
      if (ai !== bi) return ai - bi
      if (a.kind !== b.kind) return a.kind === 'library' ? -1 : 1
      return a.bundleName.localeCompare(b.bundleName)
    })
  }, [plan.rows])

  const conflictRows = sortedRows.filter((r) => r.status.tag === 'conflict')
  const unresolved = conflictRows.filter((r) => !(r.bundleOid in resolutions))

  const counts = useMemo(
    () => ({
      create: sortedRows.filter((r) => r.status.tag === 'create').length,
      add: sortedRows.filter((r) => r.status.tag === 'add-to-existing').length,
      noop: sortedRows.filter((r) => r.status.tag === 'no-op').length,
      conflict: conflictRows.length,
      refused: sortedRows.filter((r) => r.status.tag === 'refused').length,
    }),
    [sortedRows, conflictRows.length],
  )

  // Refused rows are not conflicts the user resolves: "Replace all" never reaches them.
  const bulkApply = (choice: 'keep' | 'replace') => {
    const next: Record<string, 'keep' | 'replace'> = {}
    for (const r of conflictRows) next[r.bundleOid] = choice
    setResolutions(next)
  }

  const handleImport = async () => {
    await onCommit(resolutions, effectiveTeamId)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onCancel() : null)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import workflow library: &quot;{plan.bundleLibraryName}&quot;</DialogTitle>
        </DialogHeader>

        {eligibleTeams.length > 1 && (
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="import-team">Team</label>
            <select
              id="import-team"
              aria-label="Team"
              value={effectiveTeamId}
              onChange={(e) => setTeamId(e.target.value)}
              className="h-8 rounded-md border border-slate-200 dark:border-slate-700 bg-transparent px-2"
            >
              {eligibleTeams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {plan.warnings.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-300 rounded p-2 text-xs">
            {plan.warnings.map((w, i) => (
              <div key={i}>{w}</div>
            ))}
          </div>
        )}

        <p className="text-sm">
          {counts.create} create · {counts.add} add · {counts.noop} unchanged · {counts.conflict} conflicts
          {counts.refused > 0 && ` · ${counts.refused} refused`}
        </p>

        {counts.conflict > 0 && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => bulkApply('keep')}>
              Keep all existing
            </Button>
            <Button variant="outline" size="sm" onClick={() => bulkApply('replace')}>
              Replace all with imported
            </Button>
          </div>
        )}

        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th>Action</th>
                <th>Element</th>
                <th>Existing</th>
                <th>Imported</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <RowView
                  key={row.bundleOid}
                  row={row}
                  choice={resolutions[row.bundleOid]}
                  onChoose={(c) => setResolutions((prev) => ({ ...prev, [row.bundleOid]: c }))}
                />
              ))}
            </tbody>
          </table>
        </div>

        <DialogFooter>
          <span className="text-xs text-muted-foreground mr-auto">
            {counts.conflict > 0 && `${counts.conflict - unresolved.length}/${counts.conflict} conflicts resolved`}
          </span>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={unresolved.length > 0 || !effectiveTeamId}>
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RowView({
  row,
  choice,
  onChoose,
}: {
  row: ImportPlanRow
  choice: 'keep' | 'replace' | undefined
  onChoose: (c: 'keep' | 'replace') => void
}) {
  const status = row.status
  const action =
    status.tag === 'create' ? (
      <span>Create</span>
    ) : status.tag === 'add-to-existing' ? (
      <span>Add</span>
    ) : status.tag === 'no-op' ? (
      <span>Skip (same OID)</span>
    ) : status.tag === 'refused' ? (
      // Spec 2026-10-21 §6: kept as it is; no Replace choice.
      <div className="flex flex-col">
        <span className="text-amber-700 dark:text-amber-400">{REFUSAL_LABEL[status.refusal.reason]}</span>
        {status.refusal.reason === 'changed-since-export' && (
          <span className="text-xs text-muted-foreground">
            {changedSinceExportDetail({
              fileVersion: row.bundleVersion,
              fileState: status.refusal.fileState ?? '',
              version: status.existingVersion,
              state: status.existingState,
              effectiveVersionHere: status.refusal.effectiveVersionHere,
            })}
          </span>
        )}
        {status.refusal.blockers
          .filter((b) => b.why !== 'is-locked')
          .map((b) => (
            <span key={b.specId} className="text-xs text-muted-foreground">
              {b.why === 'owns-proxy-link' ? 'Linked from' : 'Also deletes'} {b.name} v{b.version} ({b.state})
            </span>
          ))}
      </div>
    ) : (
      <div className="flex flex-col">
        <label className="flex items-center gap-1">
          <input
            type="radio"
            aria-label={`Keep ${row.bundleOid}`}
            checked={choice === 'keep'}
            onChange={() => onChoose('keep')}
          />
          Keep
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            aria-label={`Replace ${row.bundleOid}`}
            checked={choice === 'replace'}
            onChange={() => onChoose('replace')}
          />
          Replace
        </label>
      </div>
    )

  const existing =
    status.tag === 'conflict' || status.tag === 'refused' ? `${status.existingName} v${status.existingVersion}` : '—'

  return (
    <tr className={row.kind === 'specification' ? 'pl-4' : 'font-medium'}>
      <td>{action}</td>
      <td>
        {row.bundleName} <span className="text-xs text-muted-foreground">({row.entityType})</span>
      </td>
      <td>{existing}</td>
      <td>v{row.bundleVersion}</td>
    </tr>
  )
}
