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
import { Link, useNavigate, useParams } from 'react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@mission/ui'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useDeleteInstance, useInstance, useInstanceCommand } from './hooks'
import { getStateColor } from './InstancesPage'
import { formatTimestamp, formatDuration } from '@/lib/utils'
import type { StateHistoryEntry } from '@/lib/types'

// ---- Command availability by state ----
const OBSERVABLE_ACTIVE = new Set([
  'STARTING',
  'EXECUTING',
  'COMPLETING',
  'RESUMING',
  'UNHOLDING',
  'CLEARING',
])
const OBSERVABLE_PAUSING = new Set(['PAUSING'])
const OBSERVABLE_PAUSED = new Set(['PAUSED'])
const OBSERVABLE_HOLDING = new Set(['HOLDING'])
const OBSERVABLE_HELD = new Set(['HELD'])
const OBSERVABLE_STOPPING = new Set(['STOPPING', 'ABORTING'])
const TERMINAL_STATES = new Set(['COMPLETED', 'ABORTED'])

function getCommandButtons(state: string, visibility: 'observable' | 'opaque') {
  if (TERMINAL_STATES.has(state)) return []
  if (visibility === 'opaque') return ['ABORT'] // opaque: only abort in active states
  if (OBSERVABLE_ACTIVE.has(state)) return ['PAUSE', 'ABORT', 'STOP']
  if (OBSERVABLE_PAUSING.has(state)) return ['ABORT']
  if (OBSERVABLE_PAUSED.has(state)) return ['RESUME', 'ABORT']
  if (OBSERVABLE_HOLDING.has(state)) return ['ABORT']
  if (OBSERVABLE_HELD.has(state)) return ['UNHOLD', 'ABORT']
  if (OBSERVABLE_STOPPING.has(state)) return []
  return ['ABORT']
}

const COMMAND_VARIANTS: Record<string, 'destructive' | 'default' | 'outline'> = {
  PAUSE: 'outline',
  RESUME: 'default',
  ABORT: 'destructive',
  STOP: 'outline',
  UNHOLD: 'default',
  CLEAR: 'outline',
}

// ---- State Timeline ----
function StateDot({ state, size = 'sm' }: { state: string; size?: 'sm' | 'lg' }) {
  const sz = size === 'lg' ? 'w-4 h-4' : 'w-2.5 h-2.5'
  return (
    <span className={`inline-block rounded-full ${sz} ${getStateColor(state)} flex-shrink-0`} />
  )
}

function calcDuration(entry: StateHistoryEntry, nextEntry: StateHistoryEntry | undefined): string {
  if (!nextEntry) return 'running...'
  const ms = new Date(nextEntry.timestamp).getTime() - new Date(entry.timestamp).getTime()
  return formatDuration(ms)
}

function StateTimeline({
  entries,
  currentState,
}: {
  entries: StateHistoryEntry[]
  currentState: string
}) {
  if (entries.length === 0) {
    return <p className="text-muted-foreground text-sm">No state history available.</p>
  }

  return (
    <div className="relative space-y-0">
      {entries.map((entry, idx) => {
        const next = entries[idx + 1]
        const isLast = idx === entries.length - 1
        const isTerminal = TERMINAL_STATES.has(currentState)
        const durationStr = isLast ? (isTerminal ? '—' : 'running...') : calcDuration(entry, next)

        return (
          <div key={idx} className="flex gap-3 group">
            {/* Left column: dot + line */}
            <div className="flex flex-col items-center">
              <StateDot state={entry.state} size="sm" />
              {!isLast && <div className="w-px flex-1 bg-border mt-1 mb-0 min-h-[24px]" />}
            </div>

            {/* Right column: content */}
            <div className="pb-4 min-w-0 flex-1">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="font-medium text-sm">{entry.state}</span>
                <span className="text-xs text-muted-foreground">
                  {formatTimestamp(entry.timestamp)}
                </span>
                <span className="text-xs text-muted-foreground">({durationStr})</span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---- Parameters table ----
function ParametersTable({ params }: { params: Array<{ key: string; value: string }> }) {
  if (params.length === 0) {
    return <p className="text-muted-foreground text-sm">None</p>
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-1/3">Name</TableHead>
          <TableHead>Value</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {params.map((p) => (
          <TableRow key={p.key}>
            <TableCell className="font-mono text-xs text-muted-foreground">{p.key}</TableCell>
            <TableCell className="font-mono text-xs">{p.value}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export default function InstanceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const instanceId = id ?? ''
  const { data: instance, isLoading, isError, error } = useInstance(instanceId)
  const commandMutation = useInstanceCommand()
  const deleteMutation = useDeleteInstance()
  const [commandError, setCommandError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const handleCommand = async (command: string) => {
    setCommandError(null)
    try {
      await commandMutation.mutateAsync({ id: instanceId, command })
    } catch (err) {
      setCommandError(err instanceof Error ? err.message : 'Command failed')
    }
  }

  const handleDelete = async () => {
    setDeleteError(null)
    // Force-delete bypasses the state machine — confirm with the user since
    // it's destructive and works on instances stuck in any state.
    if (
      !window.confirm(
        'Permanently remove this instance record? This kills any running worker and cannot be undone.'
      )
    ) {
      return
    }
    try {
      await deleteMutation.mutateAsync(instanceId)
      navigate('/instances')
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 bg-muted rounded animate-pulse w-64" />
        <div className="h-32 bg-muted rounded animate-pulse" />
      </div>
    )
  }

  if (isError || !instance) {
    return (
      <div className="space-y-4">
        <Link to="/instances" className="text-sm text-muted-foreground hover:text-foreground">
          &larr; Back to Instances
        </Link>
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-destructive font-medium">Failed to load instance</p>
            <p className="text-muted-foreground text-sm mt-1">
              {error instanceof Error ? error.message : 'Unknown error'}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const commands = getCommandButtons(instance.state, instance.visibility)
  const isPending = commandMutation.isPending

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link to="/instances" className="text-sm text-muted-foreground hover:text-foreground">
          &larr; Back to Instances
        </Link>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div>
            <h2
              className="text-2xl font-bold text-foreground font-mono"
              title={instance.runtime_action_instance_id}
            >
              {instance.runtime_action_instance_id.slice(0, 16)}...
            </h2>
            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{instance.action_name}</span>
              <span>in</span>
              <span>{instance.environment_name}</span>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-muted">
                {instance.visibility}
              </span>
            </div>
            {(instance.workflow_instance_id || instance.step_oid) && (
              <div className="flex gap-4 mt-1 text-xs text-muted-foreground font-mono">
                {instance.workflow_instance_id && (
                  <span>Workflow: {instance.workflow_instance_id.slice(0, 12)}...</span>
                )}
                {instance.step_oid && <span>Step: {instance.step_oid.slice(0, 12)}...</span>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Current State + Commands */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Current State</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <span
              className={`inline-block w-4 h-4 rounded-full ${getStateColor(instance.state)}`}
            />
            <span className="text-2xl font-bold">{instance.state}</span>
          </div>

          {commands.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              {commands.map((cmd) => (
                <Button
                  key={cmd}
                  variant={COMMAND_VARIANTS[cmd] ?? 'outline'}
                  size="sm"
                  disabled={isPending}
                  onClick={() => void handleCommand(cmd)}
                >
                  {isPending ? 'Sending...' : cmd.charAt(0) + cmd.slice(1).toLowerCase()}
                </Button>
              ))}
            </div>
          )}

          {commandError && <p className="text-destructive text-sm">{commandError}</p>}

          {/* Force-delete is always available — its whole purpose is recovering
              instances stuck in non-terminal states that won't respond to ABORT,
              so it deliberately does NOT depend on getCommandButtons. */}
          <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-border/40">
            <Button
              variant="destructive"
              size="sm"
              disabled={deleteMutation.isPending}
              onClick={() => void handleDelete()}
              title="Force-delete this instance record (cannot be undone). Use this to clear stuck instances so the owning environment can be deleted."
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete instance'}
            </Button>
            {deleteError && <span className="text-destructive text-sm">{deleteError}</span>}
          </div>
        </CardContent>
      </Card>

      {/* State Timeline */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">State Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <StateTimeline entries={instance.state_history} currentState={instance.state} />
        </CardContent>
      </Card>

      {/* Parameters */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Input Parameters</CardTitle>
          </CardHeader>
          <CardContent>
            <ParametersTable params={instance.input_parameters} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Output Parameters</CardTitle>
          </CardHeader>
          <CardContent>
            <ParametersTable params={instance.output_parameters} />
          </CardContent>
        </Card>
      </div>

      {/* Pinned Code Versions */}
      {instance.pinned_code_versions.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pinned Code Versions</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>State</TableHead>
                  <TableHead>Version</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {instance.pinned_code_versions.map((pv) => (
                  <TableRow key={pv.state}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {pv.state}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {pv.code_version_id.slice(0, 8)}...
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
