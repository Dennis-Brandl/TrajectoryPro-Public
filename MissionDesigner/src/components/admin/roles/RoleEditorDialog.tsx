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

// Create/edit a role in the GLOBAL catalog (design §3 — rights apply only in
// the teams where the role is assigned). Rights are a replace-set; the grid is
// 7 verbs × 3 categories = the closed 21-right catalog.

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from '@mission/ui'
import { adminErrorMessage, createRole, patchRole, type Role } from '@/lib/admin/adminClient'
import { CATEGORY_LABELS, RIGHTS_CATEGORIES, RIGHT_VERBS, rightId } from '@/lib/admin/rightsCatalog'

interface RoleEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Editing an existing role when set; creating otherwise. */
  initial: Role | null
  onSaved: () => void
}

export function RoleEditorDialog({ open, onOpenChange, initial, onSaved }: RoleEditorDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [rights, setRights] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  // Reset the form whenever the dialog (re)opens.
  useEffect(() => {
    if (!open) return
    setName(initial?.name ?? '')
    setDescription(initial?.description ?? '')
    setRights(new Set(initial?.rights ?? []))
  }, [open, initial])

  const toggleRight = (id: string) => {
    setRights((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const rightsList = [...rights]
      if (initial) {
        await patchRole(initial.id, { name, description: description || null, rights: rightsList })
      } else {
        await createRole({ name, description: description || undefined, rights: rightsList })
      }
      toast.success(initial ? 'Role updated' : 'Role created')
      onSaved()
      onOpenChange(false)
    } catch (err) {
      toast.error(adminErrorMessage(err, 'Failed to save role'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{initial ? `Edit role: ${initial.name}` : 'New role'}</DialogTitle>
          <DialogDescription>
            Roles are a global catalog — rights apply only in the teams where the role is assigned.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="role-name">Name</Label>
            <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} disabled={saving} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="role-description">Description</Label>
            <Textarea
              id="role-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              disabled={saving}
            />
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-left font-medium text-muted-foreground pb-1">Right</th>
                {RIGHTS_CATEGORIES.map((c) => (
                  <th key={c} className="text-center font-medium text-muted-foreground pb-1">
                    {CATEGORY_LABELS[c]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {RIGHT_VERBS.map(({ verb, label }) => (
                <tr key={verb} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1.5">{label}</td>
                  {RIGHTS_CATEGORIES.map((c) => {
                    const id = rightId(c, verb)
                    return (
                      <td key={id} className="text-center">
                        <input
                          type="checkbox"
                          aria-label={`${label} — ${CATEGORY_LABELS[c]}`}
                          checked={rights.has(id)}
                          disabled={saving}
                          onChange={() => toggleRight(id)}
                          className="h-4 w-4 rounded border-gray-300 accent-primary cursor-pointer"
                        />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || name.trim().length === 0}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Saving...
              </>
            ) : (
              'Save'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
