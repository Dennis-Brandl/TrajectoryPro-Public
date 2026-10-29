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

import { Fragment, useMemo } from 'react'
import { useParams, Link } from 'react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useEnvironment } from './hooks'
import { EnvironmentPropertiesCard } from '@/features/properties/EnvironmentPropertiesCard'
import { ActionImportBadges, ActionImportFlag } from '@/features/actions/ActionImportFlag'
import { formatTimestamp } from '@/lib/utils'
import type { ActionSummaryInEnvironment } from '@/lib/types'
import { useRegisterRightPane } from '@/layout/RightPaneContext'

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

function CodeStatusBadge({ states }: { states: string[] }) {
  if (states.length === 0) {
    return <span className="text-xs text-muted-foreground">None</span>
  }
  return (
    <div className="flex flex-wrap gap-1">
      {states.map((s) => (
        <span
          key={s}
          className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-green-100 text-green-700"
        >
          {s}
        </span>
      ))}
    </div>
  )
}

export function ActionsTable({ actions }: { actions: ActionSummaryInEnvironment[] }) {
  if (actions.length === 0) {
    return (
      <p className="text-muted-foreground text-xs text-center py-3">
        No actions in this environment
      </p>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="h-7">Name</TableHead>
          <TableHead className="h-7">Visibility</TableHead>
          <TableHead className="h-7 text-center">Inputs</TableHead>
          <TableHead className="h-7 text-center">Outputs</TableHead>
          <TableHead className="h-7">Code Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {actions.map((action) => (
          <Fragment key={action.oid}>
            <TableRow>
              <TableCell className="py-1">
                <Link
                  to={`/actions/${action.oid}`}
                  className="text-xs font-medium hover:underline text-primary"
                >
                  {action.local_id}
                </Link>
                <p className="font-mono text-xs text-muted-foreground mt-0.5">v{action.version}</p>
                <ActionImportBadges action={action} />
              </TableCell>
              <TableCell className="py-1 text-xs">
                <VisibilityBadge visibility={action.action_visibility} />
              </TableCell>
              <TableCell className="py-1 text-center text-xs text-muted-foreground">
                {action.input_param_count}
              </TableCell>
              <TableCell className="py-1 text-center text-xs text-muted-foreground">
                {action.output_param_count}
              </TableCell>
              <TableCell className="py-1 text-xs">
                <CodeStatusBadge states={action.states_with_code} />
              </TableCell>
            </TableRow>
            {(action.signature_change || action.orphaned_at) && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="py-1">
                  <ActionImportFlag action={action} />
                </TableCell>
              </TableRow>
            )}
          </Fragment>
        ))}
      </TableBody>
    </Table>
  )
}

export default function EnvironmentDetailPage() {
  const { oid } = useParams<{ oid: string }>()
  const { data, isLoading, isError, error } = useEnvironment(oid ?? '')

  // When the environment is deleted from another panel (e.g. the Environments
  // list), React Query keeps the last successful `data` payload while
  // returning isError=true on the refetch (default keepPreviousData behavior).
  // Without the isError guard, useMemo would keep returning a pane payload
  // built from the stale env, leaving the right pane showing actions/properties
  // of an environment that no longer exists — and pairing badly with the
  // "Failed to load environment" error rendered below. Treat isError as
  // equivalent to no-data for pane registration so the pane clears on delete.
  const panePayload = useMemo(() => {
    if (isError || !data) return null
    return {
      header: { eyebrow: 'ENVIRONMENT', name: `${data.local_id} v${data.version}` },
      content: (
        <>
          {data.action_property_specifications.length > 0 && (
            <EnvironmentPropertiesCard
              environmentOid={data.oid}
              specs={data.action_property_specifications}
            />
          )}

          <Card className="py-2 gap-1">
            <CardHeader className="pb-0 px-3">
              <CardTitle className="text-sm">
                Actions{' '}
                <span className="text-muted-foreground font-normal text-sm">
                  ({data.actions.length})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3">
              <ActionsTable actions={data.actions} />
            </CardContent>
          </Card>
        </>
      ),
    }
  }, [data, isError])

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
            <p className="text-destructive font-medium">Failed to load environment</p>
            <p className="text-muted-foreground text-sm mt-1">
              {error instanceof Error ? error.message : 'Environment not found'}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const { local_id, version, description, imported_at, last_modified_date } = data

  return (
    <div className="space-y-6">
      <Link to="/environments" className="text-primary hover:underline text-sm">
        &larr; Environments
      </Link>

      <div className="space-y-1">
        <div className="flex items-baseline gap-3">
          <h2 className="text-2xl font-bold text-foreground">{local_id}</h2>
          <span className="text-sm text-muted-foreground font-medium bg-muted px-2 py-0.5 rounded">
            v{version}
          </span>
        </div>
        {description && <p className="text-muted-foreground">{description}</p>}
        <p className="font-mono text-xs text-muted-foreground" title={data.oid}>
          OID: {data.oid}
        </p>
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground pt-1">
          <span>Imported: {formatTimestamp(imported_at)}</span>
          {last_modified_date && <span>Last modified: {formatTimestamp(last_modified_date)}</span>}
        </div>
      </div>
    </div>
  )
}
