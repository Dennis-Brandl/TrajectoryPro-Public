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

import { useDashboard } from './hooks'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatUptime, formatDuration, formatTimestamp } from '@/lib/utils'
import type { FinalStatus } from '@/lib/types'

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

export default function DashboardPage() {
  const { data, isLoading, isError, error } = useDashboard()

  if (isLoading) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-bold text-foreground">Dashboard</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  <div className="h-4 bg-muted rounded animate-pulse w-24" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-8 bg-muted rounded animate-pulse w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-bold text-foreground">Dashboard</h2>
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-destructive font-medium">Failed to load dashboard data</p>
            <p className="text-muted-foreground text-sm mt-1">
              {error instanceof Error ? error.message : 'Unknown error'}
            </p>
            <p className="text-muted-foreground text-xs mt-2">Retrying every 5 seconds...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!data) return null

  const { container, python_pool, instances, log, recent_log_entries } = data

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-foreground">Dashboard</h2>

      {/* Status cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Uptime */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Uptime</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatUptime(container.uptime_seconds)}</div>
            <p className="text-xs text-muted-foreground mt-1">{container.node_version}</p>
          </CardContent>
        </Card>

        {/* Python Pool */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Python Pool</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {python_pool.idle}/{python_pool.size}
            </div>
            <p className="text-xs text-muted-foreground mt-1">idle / total workers</p>
            {python_pool.queued > 0 && (
              <p className="text-xs text-yellow-600 mt-1">{python_pool.queued} queued</p>
            )}
          </CardContent>
        </Card>

        {/* Active Instances */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Instances
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{instances.active_count}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {instances.completed_today} completed today
            </p>
            {instances.aborted_today > 0 && (
              <p className="text-xs text-red-600 mt-0.5">{instances.aborted_today} aborted today</p>
            )}
          </CardContent>
        </Card>

        {/* Execution Log */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Execution Log
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {log.total_entries.toLocaleString()}/{log.max_entries.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">entries used</p>
            {log.oldest_entry_at && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Since {formatTimestamp(log.oldest_entry_at)}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {recent_log_entries.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">No recent activity</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">ID</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Environment</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Completed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent_log_entries.map((entry) => (
                  <TableRow key={entry.id}>
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
                    <TableCell className="text-muted-foreground">
                      {formatDuration(entry.duration_ms)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatTimestamp(entry.completed_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
