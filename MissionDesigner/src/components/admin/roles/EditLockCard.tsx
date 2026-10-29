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

// Design D12: the admin-tunable edit-lock list. The engine reads the setting
// fresh per check, so saving takes effect on the next request.

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Save } from 'lucide-react'
import { Button } from '@mission/ui'
import type { SpecificationState } from '@/types/library'
import {
  ALL_SPECIFICATION_STATES,
  adminErrorMessage,
  getEditLockedStates,
  putEditLockedStates,
} from '@/lib/admin/adminClient'

export function EditLockCard() {
  const [saved, setSaved] = useState<Set<SpecificationState> | null>(null)
  const [draft, setDraft] = useState<Set<SpecificationState>>(new Set())
  const [saving, setSaving] = useState(false)

  const load = async () => {
    try {
      const states = await getEditLockedStates()
      setSaved(new Set(states))
      setDraft(new Set(states))
    } catch (err) {
      toast.error(adminErrorMessage(err, 'Failed to load edit-lock setting'))
    }
  }

  useEffect(() => {
    load()
  }, [])

  const dirty = saved !== null && (saved.size !== draft.size || [...draft].some((s) => !saved.has(s)))

  const toggle = (state: SpecificationState) => {
    setDraft((prev) => {
      const next = new Set(prev)
      if (next.has(state)) next.delete(state)
      else next.add(state)
      return next
    })
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const states = await putEditLockedStates(ALL_SPECIFICATION_STATES.filter((s) => draft.has(s)))
      setSaved(new Set(states))
      setDraft(new Set(states))
      toast.success('Edit-lock setting saved')
    } catch (err) {
      toast.error(adminErrorMessage(err, 'Failed to save edit-lock setting'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Lifecycle Edit Lock</h3>
        <Button size="sm" onClick={handleSave} disabled={!dirty || saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          Save
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Content in a checked state cannot be edited or deleted (administrators override). Unchecking Approved or
        Effective allows editing published content — not recommended.
      </p>
      {saved === null ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {ALL_SPECIFICATION_STATES.map((state) => (
            <label key={state} className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={draft.has(state)}
                disabled={saving}
                onChange={() => toggle(state)}
                className="h-4 w-4 rounded border-gray-300 accent-primary cursor-pointer disabled:cursor-not-allowed"
              />
              {state}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
