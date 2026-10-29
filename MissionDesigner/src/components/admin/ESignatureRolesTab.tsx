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

// Spec 2026-09-06 §4.2: the system-wide E-Signature Roles list. Plain strings, copied into
// esignature blocks by name (D10) — removing a name here never edits a form.

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Save, X } from 'lucide-react'
import { Button } from '@mission/ui'
import { adminErrorMessage, getEsignatureRoles, putEsignatureRoles } from '@/lib/admin/adminClient'

const MAX_NAME = 64
const MAX_ROLES = 200

export function ESignatureRolesTab() {
  const [saved, setSaved] = useState<string[] | null>(null)
  const [draft, setDraft] = useState<string[]>([])
  const [newName, setNewName] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    try {
      const roles = await getEsignatureRoles()
      setSaved(roles)
      setDraft(roles)
    } catch (err) {
      toast.error(adminErrorMessage(err, 'Failed to load e-signature roles'))
    }
  }

  useEffect(() => {
    load()
  }, [])

  const dirty = saved !== null && (saved.length !== draft.length || saved.some((r, i) => r !== draft[i]))

  const add = () => {
    const name = newName.trim()
    if (!name) return setAddError('Enter a role name.')
    if (name.length > MAX_NAME) return setAddError(`Role names are at most ${MAX_NAME} characters.`)
    if (draft.some((r) => r.toLowerCase() === name.toLowerCase())) return setAddError('That role is already listed.')
    if (draft.length >= MAX_ROLES) return setAddError(`At most ${MAX_ROLES} roles.`)
    setDraft((d) => [...d, name])
    setNewName('')
    setAddError(null)
  }

  const remove = (name: string) => setDraft((d) => d.filter((r) => r !== name))

  const handleSave = async () => {
    setSaving(true)
    try {
      const roles = await putEsignatureRoles(draft)
      setSaved(roles)
      setDraft(roles)
      toast.success('E-signature roles saved')
    } catch (err) {
      toast.error(adminErrorMessage(err, 'Failed to save e-signature roles'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">E-Signature Roles</h3>
        <div className="flex items-center gap-3">
          {dirty && <span className="text-xs text-amber-600 dark:text-amber-400">Unsaved changes</span>}
          <Button size="sm" onClick={handleSave} disabled={!dirty || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Save
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Names must match the role names created in Mission Commander. Removing a name here does not change existing
        forms.
      </p>
      {saved === null ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <ul className="divide-y divide-slate-200 dark:divide-slate-700">
            {draft.length === 0 && <li className="py-2 text-sm text-muted-foreground">No roles yet.</li>}
            {draft.map((name) => (
              <li key={name} className="flex items-center justify-between py-1.5 text-sm">
                <span>{name}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${name}`}
                  disabled={saving}
                  onClick={() => remove(name)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <input
                aria-label="New role name"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value)
                  setAddError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    add()
                  }
                }}
                placeholder="e.g. Time Sheet Approver"
                maxLength={MAX_NAME + 1}
                className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1 text-sm"
              />
              {addError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{addError}</p>}
            </div>
            <Button size="sm" variant="outline" onClick={add} disabled={saving}>
              Add
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
