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

// Shared role-checkbox dialog: replace-set assignment of roles to a (user, team)
// pair. Used by both the team-centric TeamMembersPanel and the account-centric
// AccountTeamsPanel so the picker can't fork. Owns its own draft, seeded from
// initialRoleIds whenever it opens; the caller performs the save + reload.
// NOTE: draft is seeded only at mount — callers MUST pass a `key` that changes
// per target (e.g. key={teamId} or key={userId}) so it remounts and re-seeds.

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@mission/ui'
import type { Role } from '@/lib/admin/adminClient'

interface RoleAssignmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  userEmail: string
  teamName: string
  allRoles: Role[]
  initialRoleIds: string[]
  saving: boolean
  onSave: (roleIds: string[]) => void
}

export function RoleAssignmentDialog({
  open,
  onOpenChange,
  userEmail,
  teamName,
  allRoles,
  initialRoleIds,
  saving,
  onSave,
}: RoleAssignmentDialogProps) {
  const [draft, setDraft] = useState<Set<string>>(new Set(initialRoleIds))

  const toggle = (roleId: string) =>
    setDraft((prev) => {
      const next = new Set(prev)
      if (next.has(roleId)) next.delete(roleId)
      else next.add(roleId)
      return next
    })

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Roles for {userEmail}</DialogTitle>
          <DialogDescription>
            Rights apply only within {teamName}. A member with no roles is a read-only viewer.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {allRoles.map((role) => (
            <label key={role.id} className="flex items-start gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                aria-label={role.name}
                checked={draft.has(role.id)}
                disabled={saving}
                onChange={() => toggle(role.id)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-primary cursor-pointer"
              />
              <span>
                <span className="font-medium">{role.name}</span>
                {role.description && <span className="text-muted-foreground"> — {role.description}</span>}
              </span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => onSave([...draft])} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Saving...
              </>
            ) : (
              'Save Roles'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
