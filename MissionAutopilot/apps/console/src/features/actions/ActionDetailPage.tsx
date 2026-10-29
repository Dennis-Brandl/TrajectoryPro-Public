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
import { useParams, Link, useNavigate } from 'react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@mission/ui'
import { Button } from '@mission/ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@mission/ui'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useAction, useUpdateActionTimeout, useClearCode } from './hooks'
import { ExportImportButtons } from './ExportImportButtons'
import StateHistorySheet from '@/features/code-editor/StateHistorySheet'
import { ActionPropertiesCard } from '@/features/properties/ActionPropertiesCard'
import { ActionImportFlag } from './ActionImportFlag'
import { formatTimestamp } from '@/lib/utils'
import type { ActionDetail, InputParameterSpec, OutputParameterSpec } from '@/lib/types'
import { useRegisterRightPane } from '@/layout/RightPaneContext'

// ISA-88 states that support user code (observable actions expose full state machine)
const OBSERVABLE_CODE_STATES = [
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

// Opaque actions expose simplified lifecycle states
const OPAQUE_CODE_STATES = [
  'POSTED',
  'RECEIVED',
  'IN_PROGRESS',
  'COMPLETED',
  'ABORTING',
  'STOPPING',
]

function VisibilityBadge({ visibility }: { visibility: 'observable' | 'opaque' }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
        visibility === 'observable'
          ? 'bg-blue-50 text-blue-700 border-blue-200'
          : 'bg-gray-100 text-gray-600 border-gray-200'
      }`}
    >
      {visibility}
    </span>
  )
}

function InputParamsTable({ params }: { params: InputParameterSpec[] }) {
  if (params.length === 0) {
    return <p className="text-muted-foreground text-xs text-center py-2">No input parameters</p>
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="h-7">ID</TableHead>
          <TableHead className="h-7">Default</TableHead>
          <TableHead className="h-7">Description</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {params.map((p) => (
          <TableRow key={p.id}>
            <TableCell className="font-mono text-xs font-medium py-1">{p.id}</TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground py-1">
              {p.default_value}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground py-1">
              {p.description ?? '—'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function OutputParamsTable({ params }: { params: OutputParameterSpec[] }) {
  if (params.length === 0) {
    return <p className="text-muted-foreground text-xs text-center py-2">No output parameters</p>
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="h-7">ID</TableHead>
          <TableHead className="h-7">Default</TableHead>
          <TableHead className="h-7">Description</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {params.map((p) => (
          <TableRow key={p.id}>
            <TableCell className="font-mono text-xs font-medium py-1">{p.id}</TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground py-1">
              {p.default_value}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground py-1">
              {p.description ?? '—'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function CodeStatusSection({
  actionOid,
  statesWithCode,
  visibility,
  onClearState,
  onShowHistory,
}: {
  actionOid: string
  statesWithCode: string[]
  visibility: 'observable' | 'opaque'
  onClearState: (state: string) => void
  onShowHistory: (state: string) => void
}) {
  const stateSet = new Set(statesWithCode)
  const applicableStates = visibility === 'opaque' ? OPAQUE_CODE_STATES : OBSERVABLE_CODE_STATES

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>State</TableHead>
          <TableHead>Code</TableHead>
          <TableHead>Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {applicableStates.map((state) => {
          const hasCode = stateSet.has(state)
          return (
            <TableRow key={state}>
              <TableCell className="font-mono text-sm">{state}</TableCell>
              <TableCell>
                {hasCode ? (
                  <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700">
                    active
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">no code</span>
                )}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-3">
                  <Link
                    to={`/actions/${actionOid}/code/${state}`}
                    className="text-xs text-primary hover:underline"
                  >
                    Edit
                  </Link>
                  {hasCode && (
                    <button
                      type="button"
                      onClick={() => onShowHistory(state)}
                      className="text-xs text-primary hover:underline"
                    >
                      History
                    </button>
                  )}
                  {hasCode && (
                    <button
                      type="button"
                      onClick={() => onClearState(state)}
                      className="text-xs text-destructive hover:underline"
                    >
                      Clear Code
                    </button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

function TimeoutSection({ action }: { action: ActionDetail }) {
  const updateTimeout = useUpdateActionTimeout()
  const [mode, setMode] = useState<'global' | 'custom' | 'disabled'>(
    action.timeout_seconds === null
      ? 'global'
      : action.timeout_seconds === 0
        ? 'disabled'
        : 'custom'
  )
  const [customValue, setCustomValue] = useState(
    action.timeout_seconds && action.timeout_seconds > 0 ? String(action.timeout_seconds) : '60'
  )

  function handleSave() {
    const value =
      mode === 'global' ? null : mode === 'disabled' ? 0 : parseInt(customValue, 10) || 60
    updateTimeout.mutate({ oid: action.oid, timeout_seconds: value })
  }

  return (
    <Card className="py-2 gap-1">
      <CardHeader className="pb-0 px-3">
        <CardTitle className="text-sm">Execution Settings</CardTitle>
      </CardHeader>
      <CardContent className="px-3 space-y-2">
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="radio"
              name="timeout"
              checked={mode === 'global'}
              onChange={() => setMode('global')}
            />
            Use global default
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="radio"
              name="timeout"
              checked={mode === 'custom'}
              onChange={() => setMode('custom')}
            />
            Custom:
            <Input
              type="number"
              min="1"
              className="w-20 h-7 text-xs"
              value={customValue}
              onChange={(e) => {
                setCustomValue(e.target.value)
                setMode('custom')
              }}
              disabled={mode !== 'custom'}
            />
            <span className="text-xs text-muted-foreground">seconds</span>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="radio"
              name="timeout"
              checked={mode === 'disabled'}
              onChange={() => setMode('disabled')}
            />
            Disabled (no timeout)
          </label>
        </div>
        <Button size="sm" onClick={handleSave} disabled={updateTimeout.isPending}>
          {updateTimeout.isPending ? 'Saving...' : 'Save'}
        </Button>
      </CardContent>
    </Card>
  )
}

export default function ActionDetailPage() {
  const { oid } = useParams<{ oid: string }>()
  const { data, isLoading, isError, error, refetch } = useAction(oid ?? '')
  const navigate = useNavigate()
  const clearCode = useClearCode()
  const [pendingClear, setPendingClear] = useState<string | null>(null)
  const [historyState, setHistoryState] = useState<string | null>(null)
  // Hold the last non-null value so the dialog title doesn't flash "Delete all code for ?"
  // while the close animation runs after pendingClear is reset to null.
  const lastPendingClearRef = useRef('')
  if (pendingClear !== null) lastPendingClearRef.current = pendingClear

  const panePayload = useMemo(() => {
    if (!data) return null
    return {
      header: { eyebrow: 'ACTION', name: `${data.local_id} v${data.version}` },
      content: (
        <>
          <ActionImportFlag
            action={data}
            onDeleted={() => navigate(`/environments/${data.environment_oid}`)}
          />

          <Card className="py-2 gap-1">
            <CardHeader className="pb-0 px-3">
              <CardTitle className="text-sm">
                Input Parameters{' '}
                <span className="text-muted-foreground font-normal text-sm">
                  ({data.input_parameter_specifications.length})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3">
              <InputParamsTable params={data.input_parameter_specifications} />
            </CardContent>
          </Card>

          <Card className="py-2 gap-1">
            <CardHeader className="pb-0 px-3">
              <CardTitle className="text-sm">
                Output Parameters{' '}
                <span className="text-muted-foreground font-normal text-sm">
                  ({data.output_parameter_specifications.length})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3">
              <OutputParamsTable params={data.output_parameter_specifications} />
            </CardContent>
          </Card>

          {data.property_specifications.length > 0 && (
            <ActionPropertiesCard actionOid={data.oid} specs={data.property_specifications} />
          )}

          <TimeoutSection action={data} />
        </>
      ),
    }
  }, [data, navigate])

  useRegisterRightPane(panePayload)

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link to="/environments" className="text-primary hover:underline text-sm">
            &larr; Environments
          </Link>
        </div>
        <div className="space-y-2">
          <div className="h-7 bg-muted rounded animate-pulse w-48" />
          <div className="h-4 bg-muted rounded animate-pulse w-64" />
        </div>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link to="/environments" className="text-primary hover:underline text-sm">
            &larr; Environments
          </Link>
        </div>
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-destructive font-medium">Failed to load action</p>
            <p className="text-muted-foreground text-sm mt-1">
              {error instanceof Error ? error.message : 'Action not found'}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const {
    local_id,
    version,
    description,
    action_visibility,
    environment_oid,
    environment_name,
    code_summary,
  } = data

  function confirmClear() {
    if (!pendingClear || !data) return
    clearCode.mutate(
      { actionOid: data.oid, state: pendingClear },
      {
        onSuccess: () => {
          setPendingClear(null)
        },
      }
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm">
        <Link to="/environments" className="text-primary hover:underline">
          Environments
        </Link>
        <span className="text-muted-foreground">/</span>
        <Link to={`/environments/${environment_oid}`} className="text-primary hover:underline">
          {environment_name}
        </Link>
      </div>

      <div className="space-y-1">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h2 className="text-2xl font-bold text-foreground">{local_id}</h2>
          <span className="text-sm text-muted-foreground font-medium bg-muted px-2 py-0.5 rounded">
            v{version}
          </span>
          <VisibilityBadge visibility={action_visibility} />
        </div>
        {description && <p className="text-muted-foreground">{description}</p>}
        <p className="font-mono text-xs text-muted-foreground" title={data.oid}>
          OID: {data.oid}
        </p>
        <p className="text-xs text-muted-foreground">
          Environment:{' '}
          <Link to={`/environments/${environment_oid}`} className="text-primary hover:underline">
            {environment_name}
          </Link>
        </p>
        {code_summary.last_code_update && (
          <p className="text-xs text-muted-foreground">
            Last code update: {formatTimestamp(code_summary.last_code_update)}
          </p>
        )}
      </div>

      <ExportImportButtons actionOid={data.oid} onImportComplete={() => void refetch()} />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Code Status{' '}
            <span className="text-muted-foreground font-normal text-sm">
              ({code_summary.states_with_code.length} states with code,{' '}
              {code_summary.total_versions} version
              {code_summary.total_versions !== 1 ? 's' : ''} total)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CodeStatusSection
            actionOid={data.oid}
            statesWithCode={code_summary.states_with_code}
            visibility={action_visibility}
            onClearState={(state) => setPendingClear(state)}
            onShowHistory={(state) => setHistoryState(state)}
          />
        </CardContent>
      </Card>

      <StateHistorySheet
        actionOid={data.oid}
        state={historyState}
        onClose={() => setHistoryState(null)}
      />

      <Dialog
        open={pendingClear !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingClear(null)
            clearCode.reset()
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete all code for {lastPendingClearRef.current}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This removes the active version and all version history for this state. This cannot be
            undone.
          </p>
          {clearCode.isError && (
            <p className="text-sm text-destructive">
              {clearCode.error instanceof Error
                ? clearCode.error.message
                : 'Delete failed. Please try again.'}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPendingClear(null)}
              disabled={clearCode.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={confirmClear}
              disabled={clearCode.isPending}
            >
              {clearCode.isPending ? 'Deleting...' : 'Delete all versions'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
