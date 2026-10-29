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
import { Input } from '@mission/ui'

interface Props {
  open: boolean
  orphanCount: number
  orphanDescendantsCount: number
  reparentCount: number
  onConfirm: () => void
  onCancel: () => void
}

export function DestructiveConfirmDialog({
  open,
  orphanCount,
  orphanDescendantsCount,
  reparentCount,
  onConfirm,
  onCancel,
}: Props) {
  const [typed, setTyped] = useState('')
  if (!open) return null
  const armed = typed === 'DELETE'

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow-xl w-full max-w-md p-6">
        <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Confirm destructive changes</h3>
        <div className="mt-3 text-sm text-slate-700 dark:text-slate-300 space-y-2">
          {orphanCount > 0 && (
            <p>
              Delete <strong>{orphanCount}</strong> orphan workflow{orphanCount === 1 ? '' : 's'} (cascading to{' '}
              <strong>{orphanDescendantsCount}</strong> descendants).
            </p>
          )}
          {reparentCount > 0 && (
            <p>
              Re-parent <strong>{reparentCount}</strong> embedded child{reparentCount === 1 ? '' : 'ren'}.
            </p>
          )}
          <p className="text-amber-700 dark:text-amber-400">
            Applied deletions are permanent. There is no built-in undo.
          </p>
        </div>
        <div className="mt-4">
          <label className="text-xs text-slate-500 dark:text-slate-400">Type DELETE to confirm:</label>
          <Input
            type="text"
            className="mt-1 font-mono text-slate-900 dark:text-slate-100"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
          />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setTyped('')
              onCancel()
            }}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!armed}
            onClick={() => {
              setTyped('')
              onConfirm()
            }}
            className={armed ? 'bg-red-600 hover:bg-red-700' : ''}
          >
            Apply fixes
          </Button>
        </div>
      </div>
    </div>
  )
}
