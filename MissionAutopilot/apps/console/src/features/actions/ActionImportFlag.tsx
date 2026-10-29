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
import { Button } from '@mission/ui'
import { useResolveSignatureChange, useDeleteAction } from './hooks'
import { formatTimestamp } from '@/lib/utils'
import type { SignatureChange } from '@/lib/types'

/** The slice of an action both the Environment pane rows and the Action pane carry. */
export interface ImportFlaggedAction {
  oid: string
  local_id: string
  signature_change: SignatureChange | null
  orphaned_at: string | null
}

function hasFlag(action: ImportFlaggedAction): boolean {
  return action.signature_change !== null || action.orphaned_at !== null
}

function Badge({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
      {children}
    </span>
  )
}

/** Compact pills for table rows; renders nothing for a clean action. */
export function ActionImportBadges({ action }: { action: ImportFlaggedAction }) {
  if (!hasFlag(action)) return null
  return (
    <span className="inline-flex flex-wrap gap-1">
      {action.signature_change && <Badge>Signature changed</Badge>}
      {action.orphaned_at && <Badge>Not in last import</Badge>}
    </span>
  )
}

/**
 * The amber note an environment re-import can leave on an action. Renders
 * nothing when the action carries no flag, so callers can drop it in freely.
 */
export function ActionImportFlag({
  action,
  onDeleted,
}: {
  action: ImportFlaggedAction
  onDeleted?: () => void
}) {
  const resolve = useResolveSignatureChange()
  const remove = useDeleteAction()
  const [confirming, setConfirming] = useState(false)

  if (!hasFlag(action)) return null
  const error = resolve.error ?? remove.error

  return (
    <div
      role="note"
      className="rounded-md border border-amber-300 bg-amber-50 p-2 space-y-2 text-xs text-amber-900"
    >
      {action.signature_change && (
        <div className="space-y-1">
          <p className="font-semibold">Signature changed on import</p>
          <p className="text-amber-800">
            The inputs or outputs no longer match what the state code was written against (flagged{' '}
            {formatTimestamp(action.signature_change.flagged_at)}). Fix the code, then mark this
            resolved.
          </p>
          <ul className="list-disc pl-4 font-mono">
            {action.signature_change.changes.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            disabled={resolve.isPending}
            onClick={() => resolve.mutate(action.oid)}
          >
            Mark resolved
          </Button>
        </div>
      )}

      {action.orphaned_at && (
        <div className="space-y-1">
          <p className="font-semibold">Not in the last import</p>
          <p className="text-amber-800">
            This action was removed from the environment in Mission Designer but was kept because it
            still has code or a running instance. Delete it here when it is no longer needed.
          </p>
          {confirming ? (
            <div className="flex items-center gap-2">
              <span>Delete this action and its code?</span>
              <Button
                variant="destructive"
                size="sm"
                className="h-7 text-xs"
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate(action.oid, {
                    onSuccess: () => {
                      setConfirming(false)
                      onDeleted?.()
                    },
                  })
                }
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
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setConfirming(true)}
            >
              Delete
            </Button>
          )}
        </div>
      )}

      {error && <p className="text-destructive">{error.message}</p>}
    </div>
  )
}
