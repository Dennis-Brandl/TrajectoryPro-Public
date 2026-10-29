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

import { Link } from 'react-router'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent } from '@/components/ui/card'
import { useActiveInstances, useHistoryInstances } from './hooks'
import { formatDuration, formatTimestamp } from '@/lib/utils'
import type { FinalStatus } from '@/lib/types'

// State color mapping shared utility
const STATE_COLORS: Record<string, string> = {
  // Green — actively progressing
  STARTING: 'bg-green-500',
  EXECUTING: 'bg-green-500',
  COMPLETING: 'bg-green-500',
  RESUMING: 'bg-green-500',
  UNHOLDING: 'bg-green-500',
  CLEARING: 'bg-green-500',
  // Yellow — paused/held
  PAUSING: 'bg-yellow-400',
  PAUSED: 'bg-yellow-400',
  HOLDING: 'bg-yellow-400',
  HELD: 'bg-yellow-400',
  // Red — aborting/stopping
  ABORTING: 'bg-red-500',
  STOPPING: 'bg-red-500',
  // Gray — terminal
  COMPLETED: 'bg-gray-400',
  ABORTED: 'bg-gray-400',
  STOPPED: 'bg-gray-400',
}

export function getStateColor(state: string): string {
  return STATE_COLORS[state] ?? 'bg-gray-400'
}

function StateDot({ state }: { state: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block w-2 h-2 rounded-full ${getStateColor(state)}`} />
      <span>{state}</span>
    </span>
  )
}

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

function ActiveTab() {
  const { data, isLoading, isError, error } = useActiveInstances()

  if (isLoading) {
    return (
      <div className="space-y-2 py-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 bg-muted rounded animate-pulse" />
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <Card className="border-destructive mt-4">
        <CardContent className="pt-6">
          <p className="text-destructive font-medium">Failed to load active instances</p>
          <p className="text-muted-foreground text-sm mt-1">
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </CardContent>
      </Card>
    )
  }

  const instances = data?.instances ?? []

  if (instances.length === 0) {
    return (
      <Card className="mt-4">
        <CardContent className="pt-6">
          <p className="text-center text-muted-foreground py-8">No active instances</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-48">Instance ID</TableHead>
          <TableHead>Action</TableHead>
          <TableHead>Environment</TableHead>
          <TableHead>State</TableHead>
          <TableHead>Since</TableHead>
          <TableHead className="w-20"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {instances.map((inst) => (
          <TableRow
            key={inst.runtime_action_instance_id}
            className="cursor-pointer hover:bg-muted/50"
          >
            <TableCell className="font-mono text-xs">
              <Link
                to={`/instances/${inst.runtime_action_instance_id}`}
                className="hover:underline text-primary"
                title={inst.runtime_action_instance_id}
              >
                {inst.runtime_action_instance_id.slice(0, 8)}...
              </Link>
            </TableCell>
            <TableCell className="font-medium">{inst.action_name}</TableCell>
            <TableCell className="text-muted-foreground">{inst.environment_name}</TableCell>
            <TableCell>
              <StateDot state={inst.state} />
            </TableCell>
            <TableCell className="text-muted-foreground text-sm">
              {formatTimestamp(inst.created_at)}
            </TableCell>
            <TableCell>
              <Link
                to={`/instances/${inst.runtime_action_instance_id}`}
                className="text-xs text-primary hover:underline"
              >
                Detail
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function HistoryTab() {
  const { data, isLoading, isError, error } = useHistoryInstances()

  if (isLoading) {
    return (
      <div className="space-y-2 py-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 bg-muted rounded animate-pulse" />
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <Card className="border-destructive mt-4">
        <CardContent className="pt-6">
          <p className="text-destructive font-medium">Failed to load instance history</p>
          <p className="text-muted-foreground text-sm mt-1">
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </CardContent>
      </Card>
    )
  }

  const instances = data?.instances ?? []

  if (instances.length === 0) {
    return (
      <Card className="mt-4">
        <CardContent className="pt-6">
          <p className="text-center text-muted-foreground py-8">No instance history</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-48">Instance ID</TableHead>
          <TableHead>Action</TableHead>
          <TableHead>Environment</TableHead>
          <TableHead>Final Status</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead>Completed</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {instances.map((inst) => (
          <TableRow key={inst.runtime_action_instance_id}>
            <TableCell className="font-mono text-xs">
              <Link
                to={`/instances/${inst.runtime_action_instance_id}`}
                className="hover:underline text-primary"
                title={inst.runtime_action_instance_id}
              >
                {inst.runtime_action_instance_id.slice(0, 8)}...
              </Link>
            </TableCell>
            <TableCell className="font-medium">{inst.action_name}</TableCell>
            <TableCell className="text-muted-foreground">{inst.environment_name}</TableCell>
            <TableCell>
              <StatusBadge status={inst.state as FinalStatus} />
            </TableCell>
            <TableCell className="text-muted-foreground text-sm">
              {inst.started_at && inst.completed_at
                ? formatDuration(
                    new Date(inst.completed_at).getTime() - new Date(inst.started_at).getTime()
                  )
                : '—'}
            </TableCell>
            <TableCell className="text-muted-foreground text-sm">
              {inst.completed_at ? formatTimestamp(inst.completed_at) : '—'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export default function InstancesPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-foreground">Action Instances</h2>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          Auto-refresh: ON
        </span>
      </div>

      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="active" className="mt-4">
          <ActiveTab />
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          <HistoryTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
