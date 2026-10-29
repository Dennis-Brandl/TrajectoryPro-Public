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

// Create-a-user dialog (design §7): name/email/password/admin + an inline
// "teams & roles" picker (select teams, and per selected team choose roles).
// On submit: createUser → for each chosen team addMember + setMemberRoles.
// Reused by the first-run wizard's "+ Add another administrator" with
// lockAdministrator + hideTeamsAndRoles (admins aren't enrolled in teams, D8).

import { useEffect, useState } from 'react'
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
} from '@mission/ui'
import {
  addMember,
  adminErrorMessage,
  createUser,
  listRoles,
  listTeams,
  setMemberRoles,
  type Role,
  type TeamWithCounts,
  type UserAccount,
} from '@/lib/admin/adminClient'

interface AddAccountDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (user: UserAccount) => void
  /** Wizard "+ Add another administrator": force Administrator on and hide the teams/roles section (D8). */
  lockAdministrator?: boolean
  hideTeamsAndRoles?: boolean
}

export function AddAccountDialog({
  open,
  onOpenChange,
  onCreated,
  lockAdministrator = false,
  hideTeamsAndRoles = false,
}: AddAccountDialogProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isAdministrator, setIsAdministrator] = useState(false)
  const [teams, setTeams] = useState<TeamWithCounts[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  // Selected teams → the roleIds chosen for that team. Presence of a key = membership.
  const [teamRoles, setTeamRoles] = useState<Map<string, Set<string>>>(new Map())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset the form + load the team/role catalog each time the dialog opens.
  useEffect(() => {
    if (!open) return
    setName('')
    setEmail('')
    setPassword('')
    setIsAdministrator(false)
    setTeamRoles(new Map())
    setError(null)
    if (!hideTeamsAndRoles) {
      listTeams()
        .then(setTeams)
        .catch(() => setTeams([]))
      listRoles()
        .then(setRoles)
        .catch(() => setRoles([]))
    }
  }, [open, hideTeamsAndRoles])

  const toggleTeam = (teamId: string) =>
    setTeamRoles((prev) => {
      const next = new Map(prev)
      if (next.has(teamId)) next.delete(teamId)
      else next.set(teamId, new Set())
      return next
    })

  const toggleRole = (teamId: string, roleId: string) =>
    setTeamRoles((prev) => {
      const next = new Map(prev)
      const set = new Set(next.get(teamId) ?? [])
      if (set.has(roleId)) set.delete(roleId)
      else set.add(roleId)
      next.set(teamId, set)
      return next
    })

  const handleSubmit = async () => {
    setError(null)
    if (!email.trim()) {
      setError('Email is required')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    setSubmitting(true)
    try {
      const user = await createUser({
        email: email.trim(),
        password,
        name: name.trim() || undefined,
        isAdministrator: lockAdministrator ? true : isAdministrator,
      })
      if (!hideTeamsAndRoles) {
        for (const [teamId, roleIds] of teamRoles) {
          await addMember(teamId, user.id)
          if (roleIds.size > 0) await setMemberRoles(teamId, user.id, [...roleIds])
        }
      }
      onCreated(user)
      onOpenChange(false)
    } catch (err) {
      setError(adminErrorMessage(err, 'Could not create the account'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !submitting && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{lockAdministrator ? 'Add another administrator' : 'Add account'}</DialogTitle>
          <DialogDescription>
            {lockAdministrator
              ? 'Creates an additional administrator with full access.'
              : 'Create a user account with an initial password.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="add-account-name">Name</Label>
            <Input id="add-account-name" value={name} onChange={(e) => setName(e.target.value)} disabled={submitting} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="add-account-email">Email</Label>
            <Input
              id="add-account-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="add-account-password">Password</Label>
            <Input
              id="add-account-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
            />
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              aria-label="Administrator"
              checked={lockAdministrator || isAdministrator}
              disabled={submitting || lockAdministrator}
              onChange={() => setIsAdministrator((v) => !v)}
              className="h-4 w-4 rounded border-gray-300 accent-primary cursor-pointer disabled:opacity-50"
            />
            Administrator
          </label>

          {!hideTeamsAndRoles && (
            <div className="space-y-2">
              <div className="text-sm font-medium">Teams &amp; roles</div>
              {teams.length === 0 ? (
                <p className="text-xs text-muted-foreground">No teams yet.</p>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto rounded-md border p-2">
                  {teams.map((t) => {
                    const selected = teamRoles.has(t.id)
                    return (
                      <div key={t.id} className="space-y-1">
                        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                          <input
                            type="checkbox"
                            aria-label={`Team ${t.name}`}
                            checked={selected}
                            disabled={submitting}
                            onChange={() => toggleTeam(t.id)}
                            className="h-4 w-4 rounded border-gray-300 accent-primary cursor-pointer"
                          />
                          <span className="font-medium">{t.name}</span>
                        </label>
                        {selected && (
                          <div className="ml-6 flex flex-wrap gap-x-3 gap-y-1">
                            {roles.map((r) => (
                              <label key={r.id} className="flex items-center gap-1 text-xs cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  aria-label={`${t.name}: ${r.name}`}
                                  checked={teamRoles.get(t.id)?.has(r.id) ?? false}
                                  disabled={submitting}
                                  onChange={() => toggleRole(t.id, r.id)}
                                  className="h-3.5 w-3.5 rounded border-gray-300 accent-primary cursor-pointer"
                                />
                                {r.name}
                              </label>
                            ))}
                            {roles.length === 0 && (
                              <span className="text-xs text-muted-foreground">No roles defined.</span>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              <p className="text-xs text-muted-foreground">A member with no roles is a read-only viewer.</p>
            </div>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Creating…
              </>
            ) : lockAdministrator ? (
              'Create administrator'
            ) : (
              'Create account'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
