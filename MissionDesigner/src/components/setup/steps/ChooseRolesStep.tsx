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

import { useEffect, useState } from 'react'
import { Button } from '@mission/ui'
import { getRoleTemplates, applyRoleTemplates, adminErrorMessage, type RoleTemplate } from '@/lib/admin/adminClient'
import { RoleEditorDialog } from '@/components/admin/roles/RoleEditorDialog'

export function ChooseRolesStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [templates, setTemplates] = useState<RoleTemplate[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)

  useEffect(() => {
    let active = true
    getRoleTemplates()
      .then((t) => {
        if (!active) return
        setTemplates(t)
        setChecked(new Set(t.map((r) => r.id))) // all pre-checked
      })
      .catch((err) => active && setError(adminErrorMessage(err, 'Could not load role templates')))
    return () => {
      active = false
    }
  }, [])

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const next = async () => {
    setError(null)
    setBusy(true)
    try {
      await applyRoleTemplates([...checked])
      onNext()
    } catch (err) {
      setError(adminErrorMessage(err, 'Could not apply the selected roles'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Choose starting roles</h2>
      <p className="text-sm text-muted-foreground">
        Built-in roles are pre-selected — uncheck any you don't want, or create your own.
      </p>
      <ul className="space-y-1">
        {templates.map((t) => (
          <li key={t.id}>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={checked.has(t.id)} onChange={() => toggle(t.id)} aria-label={t.name} />
              <span className="font-medium">{t.name}</span>
              <span className="text-xs text-muted-foreground">{t.description}</span>
            </label>
          </li>
        ))}
      </ul>
      <Button type="button" variant="outline" onClick={() => setEditorOpen(true)}>
        + Create custom role
      </Button>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="flex justify-between">
        <Button type="button" variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button type="button" onClick={next} disabled={busy}>
          Continue
        </Button>
      </div>
      <RoleEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        initial={null}
        onSaved={() => setEditorOpen(false)}
      />
    </div>
  )
}
