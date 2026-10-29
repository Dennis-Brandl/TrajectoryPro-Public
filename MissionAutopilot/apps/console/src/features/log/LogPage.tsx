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
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@mission/ui'
import { Input } from '@mission/ui'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@mission/ui'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useLogEntries } from './hooks'
import { formatDuration, formatTimestamp } from '@/lib/utils'
import type { FinalStatus, LogEntry, LogQueryParams, StateExecution } from '@/lib/types'

const PAGE_SIZE = 50

// ---- Status Badge ----
function StatusBadge({ status }: { status: FinalStatus }) {
  const variants: Record<FinalStatus, string> = {
    COMPLETED: 'bg-green-100 text-green-800 border-green-200',
    ABORTED: 'bg-red-100 text-red-800 border-red-200',
    STOPPED: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  }
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${variants[status]}`}
    >
      {status}
    </span>
  )
}

// ---- Expanded row detail ----
function StateExecutionRow({ se }: { se: StateExecution }) {
  const duration = se.duration_ms !== null ? formatDuration(se.duration_ms) : '—'
  return (
    <div className="flex items-start gap-3 py-1">
      <span className="font-mono text-xs text-muted-foreground w-28 shrink-0">{se.state}</span>
      <span className="text-xs text-muted-foreground w-20 shrink-0">
        {se.had_code ? `v${se.code_version_number}` : 'no code'}
      </span>
      <span className="text-xs text-muted-foreground w-20 shrink-0">{duration}</span>
      <span className="text-xs text-muted-foreground">
        {se.entered_at ? formatTimestamp(se.entered_at) : ''}
      </span>
    </div>
  )
}

function ExpandedDetail({ entry }: { entry: LogEntry }) {
  return (
    <div className="p-4 bg-muted/30 rounded-md space-y-4 text-sm">
      {/* IDs */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
            Instance ID
          </p>
          <p className="font-mono text-xs break-all">{entry.runtime_action_instance_id}</p>
        </div>
        {entry.workflow_instance_id && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
              Workflow ID
            </p>
            <p className="font-mono text-xs break-all">{entry.workflow_instance_id}</p>
          </div>
        )}
      </div>

      {/* Times */}
      <div className="grid grid-cols-3 gap-4">
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
            Started
          </p>
          <p className="text-xs">{formatTimestamp(entry.started_at)}</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
            Completed
          </p>
          <p className="text-xs">{formatTimestamp(entry.completed_at)}</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
            Duration
          </p>
          <p className="text-xs">{formatDuration(entry.duration_ms)}</p>
        </div>
      </div>

      {/* Input Parameters */}
      {entry.input_parameters.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Input Parameters
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {entry.input_parameters.map((p) => (
              <div key={p.key} className="flex gap-2">
                <span className="font-mono text-xs text-muted-foreground w-32 shrink-0 truncate">
                  {p.key}:
                </span>
                <span className="font-mono text-xs truncate">{p.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Output Parameters */}
      {entry.output_parameters.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Output Parameters
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {entry.output_parameters.map((p) => (
              <div key={p.key} className="flex gap-2">
                <span className="font-mono text-xs text-muted-foreground w-32 shrink-0 truncate">
                  {p.key}:
                </span>
                <span className="font-mono text-xs truncate">{p.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* States Executed */}
      {entry.states_executed.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            States Executed
          </p>
          <div className="space-y-0.5">
            <div className="flex gap-3 pb-1 border-b">
              <span className="font-mono text-xs font-semibold text-muted-foreground w-28 shrink-0">
                State
              </span>
              <span className="text-xs font-semibold text-muted-foreground w-20 shrink-0">
                Code
              </span>
              <span className="text-xs font-semibold text-muted-foreground w-20 shrink-0">
                Duration
              </span>
              <span className="text-xs font-semibold text-muted-foreground">Entered</span>
            </div>
            {entry.states_executed.map((se, i) => (
              <StateExecutionRow key={i} se={se} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---- Filters ----
interface Filters {
  action_name: string
  environment_oid: string
  status: FinalStatus | 'all'
  from: string
  to: string
}

const INITIAL_FILTERS: Filters = {
  action_name: '',
  environment_oid: '',
  status: 'all',
  from: '',
  to: '',
}

export default function LogPage() {
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS)
  const [appliedFilters, setAppliedFilters] = useState<Filters>(INITIAL_FILTERS)
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  // Build query params from applied filters
  const queryParams: LogQueryParams = {
    page,
    page_size: PAGE_SIZE,
  }
  if (appliedFilters.action_name) queryParams.action_name = appliedFilters.action_name
  if (appliedFilters.environment_oid) queryParams.environment_oid = appliedFilters.environment_oid
  if (appliedFilters.status !== 'all') queryParams.status = appliedFilters.status as FinalStatus
  if (appliedFilters.from) queryParams.from = appliedFilters.from
  if (appliedFilters.to) queryParams.to = appliedFilters.to

  const { data, isLoading, isError, error, refetch } = useLogEntries(queryParams)

  const entries = data?.entries ?? []
  const pagination = data?.pagination
  const logConfig = data?.log_config
  const totalPages = pagination?.total_pages ?? 1
  const totalEntries = pagination?.total_entries ?? 0

  const handleApplyFilters = () => {
    setAppliedFilters(filters)
    setPage(1)
  }

  const handleClearFilters = () => {
    setFilters(INITIAL_FILTERS)
    setAppliedFilters(INITIAL_FILTERS)
    setPage(1)
  }

  const handleRowClick = (id: number) => {
    setExpandedId(expandedId === id ? null : id)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Execution Log</h2>
          {logConfig && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {logConfig.current_entries.toLocaleString()} /{' '}
              {logConfig.max_entries.toLocaleString()} entries
              {logConfig.oldest_entry_at &&
                ` · since ${formatTimestamp(logConfig.oldest_entry_at)}`}
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          Refresh
        </Button>
      </div>

      {/* Filter bar */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <Input
              placeholder="Action name..."
              value={filters.action_name}
              onChange={(e) => setFilters((f) => ({ ...f, action_name: e.target.value }))}
            />
            <Input
              placeholder="Environment OID..."
              value={filters.environment_oid}
              onChange={(e) => setFilters((f) => ({ ...f, environment_oid: e.target.value }))}
            />
            <Select
              value={filters.status}
              onValueChange={(v) => setFilters((f) => ({ ...f, status: v as FinalStatus | 'all' }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="COMPLETED">COMPLETED</SelectItem>
                <SelectItem value="ABORTED">ABORTED</SelectItem>
                <SelectItem value="STOPPED">STOPPED</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="date"
              placeholder="From date"
              value={filters.from}
              onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
            />
            <Input
              type="date"
              placeholder="To date"
              value={filters.to}
              onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
            />
          </div>
          <div className="flex gap-2 mt-3">
            <Button size="sm" onClick={handleApplyFilters}>
              Apply Filters
            </Button>
            <Button variant="outline" size="sm" onClick={handleClearFilters}>
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      {isLoading && (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-12 bg-muted rounded animate-pulse" />
          ))}
        </div>
      )}

      {isError && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-destructive font-medium">Failed to load log entries</p>
            <p className="text-muted-foreground text-sm mt-1">
              {error instanceof Error ? error.message : 'Unknown error'}
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && (
        <>
          {entries.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <p className="text-center text-muted-foreground py-8">No log entries found</p>
              </CardContent>
            </Card>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">#</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Environment</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Completed At</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <>
                      <TableRow
                        key={entry.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => handleRowClick(entry.id)}
                      >
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          #{entry.id}
                        </TableCell>
                        <TableCell className="font-medium">{entry.action_name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {entry.environment_name}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={entry.final_status} />
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {formatDuration(entry.duration_ms)}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {formatTimestamp(entry.completed_at)}
                        </TableCell>
                      </TableRow>
                      {expandedId === entry.id && (
                        <TableRow key={`${entry.id}-detail`}>
                          <TableCell colSpan={6} className="p-2">
                            <ExpandedDetail entry={entry} />
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Pagination */}
          {totalEntries > 0 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {totalEntries.toLocaleString()} total entries · Page {page} of {totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
