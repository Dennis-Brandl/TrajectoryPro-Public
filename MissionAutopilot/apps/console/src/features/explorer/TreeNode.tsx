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

import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { ChevronRight, ChevronDown, MoreHorizontal, Download, FileText, Trash2 } from 'lucide-react'
import {
  cn,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@mission/ui'
import { usePanelContext } from '@/layout/PanelContext'
import {
  useDeleteEnvironment,
  useExportEnvironment,
  useExportEnvironmentEnvirX,
  useGenerateEnvironmentReport,
} from '@/features/environments/hooks'
import type { ExplorerAction } from './hooks'

// ISA-88 states per visibility
const OBSERVABLE_STATES = [
  'STARTING',
  'EXECUTING',
  'COMPLETING',
  'COMPLETED',
  'PAUSING',
  'PAUSED',
  'UNPAUSING',
  'HOLDING',
  'HELD',
  'UNHOLDING',
  'ABORTING',
  'ABORTED',
  'CLEARING',
  'STOPPING',
]

const OPAQUE_STATES = ['POSTED', 'RECEIVED', 'IN_PROGRESS', 'COMPLETED', 'ABORTING', 'STOPPING']

// ---- Environment Node ----

export function EnvironmentNode({
  oid,
  localId,
  actions,
  actionCount,
  version,
  lastModifiedDate,
  onActionError,
}: {
  oid: string
  localId: string
  actions: ExplorerAction[]
  actionCount: number
  version: string
  lastModifiedDate: string | null
  onActionError?: (message: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const navigate = useNavigate()
  const params = useParams()
  const deleteMutation = useDeleteEnvironment()
  const exportHook = useExportEnvironment(oid, localId)
  const envirXHook = useExportEnvironmentEnvirX(oid, localId)
  const reportHook = useGenerateEnvironmentReport(oid, localId)
  const Chevron = expanded ? ChevronDown : ChevronRight

  async function handleDelete() {
    const confirmed = window.confirm(
      `Delete environment "${localId}"?\n\nThis will permanently remove the environment, all of its actions, and every saved code version. This cannot be undone.`
    )
    if (!confirmed) return
    try {
      await deleteMutation.mutateAsync(oid)
    } catch (err) {
      onActionError?.(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  async function handleExport() {
    try {
      await exportHook.run()
    } catch (err) {
      onActionError?.(err instanceof Error ? err.message : 'Export failed')
    }
  }

  async function handleEnvirX() {
    try {
      await envirXHook.run()
    } catch (err) {
      onActionError?.(err instanceof Error ? err.message : 'WFenvirX export failed')
    }
  }

  async function handleReport() {
    try {
      await reportHook.run()
    } catch (err) {
      onActionError?.(err instanceof Error ? err.message : 'PDF report failed')
    }
  }

  const busyExport = exportHook.isPending
  const busyEnvirX = envirXHook.isPending
  const busyReport = reportHook.isPending
  const busyDelete = deleteMutation.isPending

  return (
    <div>
      <div
        className="group flex items-center gap-1 px-2 py-0.5 cursor-pointer hover:bg-muted/50 text-xs"
        onClick={() => {
          setExpanded(!expanded)
          void navigate(`/environments/${oid}`)
        }}
      >
        <Chevron size={12} className="text-muted-foreground shrink-0" />
        <span className="font-medium text-foreground truncate flex-1">{localId}</span>
        {!expanded && (
          <span className="text-[10px] text-muted-foreground group-hover:hidden">
            {actionCount}
          </span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              aria-label="Environment actions"
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity shrink-0"
            >
              <MoreHorizontal size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem disabled={busyExport} onSelect={handleExport}>
              <Download size={14} className="mr-2" />
              {busyExport ? 'Export Envir Package — Working…' : 'Export Envir Package'}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={busyEnvirX} onSelect={handleEnvirX}>
              <Download size={14} className="mr-2" />
              {busyEnvirX ? 'Export as .WFenvirX — Working…' : 'Export as .WFenvirX'}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={busyReport} onSelect={handleReport}>
              <FileText size={14} className="mr-2" />
              {busyReport ? 'Generate PDF report — Working…' : 'Generate PDF report'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={busyDelete} variant="destructive" onSelect={handleDelete}>
              <Trash2 size={14} className="mr-2" />
              {busyDelete ? 'Delete environment — Working…' : 'Delete environment'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="pl-5 pr-2 text-[10px] text-muted-foreground cursor-default">
        [v{version}] imported {formatShortDate(lastModifiedDate)}
      </div>
      {expanded &&
        actions.map((action) => (
          <ActionNode key={action.oid} action={action} currentActionOid={params.oid} />
        ))}
    </div>
  )
}

function formatShortDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  // Use UTC methods so the date doesn't shift based on the local timezone
  const m = d.getUTCMonth() + 1
  const day = d.getUTCDate()
  const year = d.getUTCFullYear()
  const nowYear = new Date().getUTCFullYear()
  if (year === nowYear) return `${m}/${day}`
  return `${m}/${day}/${String(year).slice(2)}`
}

// ---- Action Node ----

function ActionNode({
  action,
  currentActionOid,
}: {
  action: ExplorerAction
  currentActionOid?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const navigate = useNavigate()
  const { codeFilterActive } = usePanelContext()
  const isSelected = currentActionOid === action.oid
  const Chevron = expanded ? ChevronDown : ChevronRight

  const applicableStates = action.action_visibility === 'opaque' ? OPAQUE_STATES : OBSERVABLE_STATES

  const statesWithCodeSet = new Set(action.states_with_code)

  const visibleStates = codeFilterActive
    ? applicableStates.filter((s) => statesWithCodeSet.has(s))
    : applicableStates

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1 pl-5 pr-2 py-0.5 cursor-pointer hover:bg-muted/50 text-xs',
          isSelected && !expanded && 'bg-primary/10 text-primary'
        )}
        onClick={() => {
          setExpanded(!expanded)
          void navigate(`/actions/${action.oid}`)
        }}
      >
        <Chevron size={12} className="text-muted-foreground shrink-0" />
        <span
          className={cn('truncate', isSelected ? 'font-medium text-primary' : 'text-foreground')}
        >
          {action.local_id}
        </span>
        {!expanded && (
          <span className="ml-auto text-[10px] text-muted-foreground">
            {action.states_with_code.length}
          </span>
        )}
      </div>
      {expanded &&
        visibleStates.map((state) => (
          <StateNode
            key={state}
            actionOid={action.oid}
            state={state}
            hasCode={statesWithCodeSet.has(state)}
          />
        ))}
    </div>
  )
}

// ---- State Node ----

function StateNode({
  actionOid,
  state,
  hasCode,
}: {
  actionOid: string
  state: string
  hasCode: boolean
}) {
  const navigate = useNavigate()
  const params = useParams()
  const isSelected = params.oid === actionOid && params.state === state

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 pl-9 pr-2 py-0.5 cursor-pointer hover:bg-muted/50 text-xs',
        isSelected && 'bg-primary/10 border-l-2 border-primary'
      )}
      onClick={() => void navigate(`/actions/${actionOid}/code/${state}`)}
    >
      <span
        className={cn(
          'w-1.5 h-1.5 rounded-full shrink-0',
          hasCode ? 'bg-green-500' : 'bg-muted-foreground/30'
        )}
      />
      <span className={cn('truncate', hasCode ? 'text-foreground' : 'text-muted-foreground')}>
        {state}
      </span>
    </div>
  )
}
