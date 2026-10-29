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
import { Badge } from '@mission/ui'
import { Button } from '@mission/ui'
import { formatTimestamp } from '@/lib/utils'
import { useCodeVersions, useActivateVersion, useDeleteVersion } from './hooks'
import type { CodeVersionSummary } from '@/lib/types'

interface VersionHistoryProps {
  actionOid: string
  state: string
  activeVersionId: string | null
  onSelectVersion: (versionId: string, code: string | null) => void
  /** Hide Activate/Delete — list + select only (e.g. the action-detail History sheet) */
  readOnly?: boolean
}

function VersionItem({
  version,
  isSelected,
  actionOid,
  state,
  onSelectVersion,
  readOnly,
}: {
  version: CodeVersionSummary
  isSelected: boolean
  actionOid: string
  state: string
  onSelectVersion: (versionId: string, code: string | null) => void
  readOnly?: boolean
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const activateMutation = useActivateVersion()
  const deleteMutation = useDeleteVersion()

  return (
    <div
      className={`p-2 rounded border cursor-pointer transition-colors ${
        isSelected
          ? 'border-primary bg-primary/5'
          : 'border-border hover:border-muted-foreground/40 hover:bg-muted/30'
      }`}
      onClick={() => onSelectVersion(version.id, null)}
    >
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs font-mono font-medium text-foreground">
          v{version.version_number}
        </span>
        {version.is_active && (
          <Badge variant="default" className="text-[10px] h-4 px-1.5">
            Active
          </Badge>
        )}
      </div>

      {version.description && (
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{version.description}</p>
      )}

      <p className="text-[10px] text-muted-foreground mt-0.5">
        {formatTimestamp(version.created_at)}
      </p>

      {/* Actions for non-active versions */}
      {!readOnly && !version.is_active && (
        <div className="flex items-center gap-1 mt-1.5" onClick={(e) => e.stopPropagation()}>
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px] px-2 flex-1"
            disabled={activateMutation.isPending}
            onClick={() => activateMutation.mutate({ actionOid, state, versionId: version.id })}
          >
            {activateMutation.isPending ? '...' : 'Activate'}
          </Button>

          {confirmDelete ? (
            <>
              <Button
                size="sm"
                variant="destructive"
                className="h-6 text-[10px] px-2"
                disabled={deleteMutation.isPending}
                onClick={() => {
                  deleteMutation.mutate(
                    { actionOid, state, versionId: version.id },
                    { onSuccess: () => setConfirmDelete(false) }
                  )
                }}
              >
                {deleteMutation.isPending ? '...' : 'Confirm'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[10px] px-1.5"
                onClick={() => setConfirmDelete(false)}
              >
                ✕
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[10px] px-2 text-muted-foreground hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

export default function VersionHistory({
  actionOid,
  state,
  activeVersionId,
  onSelectVersion,
  readOnly,
}: VersionHistoryProps) {
  const { data, isLoading, isError } = useCodeVersions(actionOid, state)

  if (isLoading) {
    return (
      <div className="space-y-1.5">
        {[1, 2].map((i) => (
          <div key={i} className="h-12 bg-muted rounded animate-pulse" />
        ))}
      </div>
    )
  }

  if (isError) {
    return <p className="text-xs text-destructive text-center py-2">Failed to load versions</p>
  }

  const versions = data?.versions ?? []

  if (versions.length === 0) {
    return <p className="text-xs text-muted-foreground text-center py-3">No versions saved yet</p>
  }

  // Sort: highest version number first
  const sorted = [...versions].sort((a, b) => b.version_number - a.version_number)

  return (
    <div className="space-y-1.5 max-h-[40vh] overflow-y-auto pr-0.5">
      {sorted.map((version) => (
        <VersionItem
          key={version.id}
          version={version}
          isSelected={version.id === activeVersionId}
          actionOid={actionOid}
          state={state}
          onSelectVersion={onSelectVersion}
          readOnly={readOnly}
        />
      ))}
    </div>
  )
}
