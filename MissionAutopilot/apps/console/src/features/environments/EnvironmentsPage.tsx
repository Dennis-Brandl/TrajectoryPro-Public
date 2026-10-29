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
import { Link } from 'react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@mission/ui'
import { useEnvironments, useDeleteEnvironment } from './hooks'
import UploadDialog from './UploadDialog'
import { formatTimestamp } from '@/lib/utils'
import type { EnvironmentSummary } from '@/lib/types'

function EnvironmentCard({
  env,
  onDelete,
}: {
  env: EnvironmentSummary
  onDelete: (oid: string) => void
}) {
  const [confirming, setConfirming] = useState(false)

  return (
    <Card className="hover:shadow-md transition-shadow relative group">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <Link to={`/environments/${env.oid}`} className="flex-1 min-w-0">
            <CardTitle className="text-base font-semibold truncate hover:underline">
              {env.local_id}
            </CardTitle>
          </Link>
          <span className="text-xs text-muted-foreground shrink-0 font-medium bg-muted px-2 py-0.5 rounded">
            v{env.version}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* OID */}
        <p className="font-mono text-xs text-muted-foreground truncate" title={env.oid}>
          {env.oid}
        </p>

        {/* Stats row */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span>
            <span className="font-medium text-foreground">{env.action_count}</span>{' '}
            {env.action_count === 1 ? 'action' : 'actions'}
          </span>
          {env.action_property_specifications.length > 0 && (
            <span>{env.action_property_specifications.length} action props</span>
          )}
        </div>

        {/* Import date */}
        <p className="text-xs text-muted-foreground">Imported {formatTimestamp(env.imported_at)}</p>

        {/* Delete button */}
        <div className="flex justify-end pt-1">
          {confirming ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Delete?</span>
              <Button
                variant="destructive"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  onDelete(env.oid)
                  setConfirming(false)
                }}
              >
                Confirm
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => setConfirming(true)}
            >
              Delete
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export default function EnvironmentsPage() {
  const [uploadOpen, setUploadOpen] = useState(false)
  const { data, isLoading, isError, error } = useEnvironments()
  const deleteMutation = useDeleteEnvironment()

  const handleDelete = (oid: string) => {
    deleteMutation.mutate(oid)
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-foreground">Environments</h2>
          <Button disabled>Upload Package</Button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <div className="h-5 bg-muted rounded animate-pulse w-32" />
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="h-3 bg-muted rounded animate-pulse w-full" />
                <div className="h-3 bg-muted rounded animate-pulse w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-foreground">Environments</h2>
          <Button onClick={() => setUploadOpen(true)}>Upload Package</Button>
        </div>
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-destructive font-medium">Failed to load environments</p>
            <p className="text-muted-foreground text-sm mt-1">
              {error instanceof Error ? error.message : 'Unknown error'}
            </p>
          </CardContent>
        </Card>
        <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
      </div>
    )
  }

  const environments = data?.environments ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-foreground">Environments</h2>
        <Button onClick={() => setUploadOpen(true)}>Upload Package</Button>
      </div>

      {environments.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-10 space-y-3">
              <p className="text-muted-foreground font-medium">No environments imported yet</p>
              <p className="text-muted-foreground text-sm">
                Click{' '}
                <button className="text-primary underline" onClick={() => setUploadOpen(true)}>
                  Upload Package
                </button>{' '}
                to import a .WFenvir or .WFaction file.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {environments.map((env) => (
            <EnvironmentCard key={env.oid} env={env} onDelete={handleDelete} />
          ))}
        </div>
      )}

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
    </div>
  )
}
