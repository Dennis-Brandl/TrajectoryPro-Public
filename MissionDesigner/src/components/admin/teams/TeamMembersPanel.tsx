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

// Membership = visibility (design §3); a member with no roles is a read-only
// viewer. Role assignment is a replace-set per (user, team). The user
// directory comes from adminClient.listUsers (GET /api/v2/admin/users).

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Pencil, UserMinus, UserPlus } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
} from '@mission/ui'
import {
  addMember,
  adminErrorMessage,
  listMembers,
  listRoles,
  listUsers,
  removeMember,
  setMemberRoles,
  type Role,
  type TeamMember,
  type UserAccount,
} from '@/lib/admin/adminClient'
import { RoleAssignmentDialog } from '../roles/RoleAssignmentDialog'

interface TeamMembersPanelProps {
  teamId: string
  teamName: string
  /** Member add/remove changes the team list's memberCount — let the parent refresh. */
  onMembershipChanged: () => void
}

export function TeamMembersPanel({ teamId, teamName, onMembershipChanged }: TeamMembersPanelProps) {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [users, setUsers] = useState<UserAccount[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [addUserId, setAddUserId] = useState('')
  const [adding, setAdding] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<TeamMember | null>(null)
  const [removing, setRemoving] = useState(false)
  const [rolesTarget, setRolesTarget] = useState<TeamMember | null>(null)
  const [savingRoles, setSavingRoles] = useState(false)

  const fetchMembers = async () => {
    setLoading(true)
    setError(null)
    try {
      setMembers(await listMembers(teamId))
    } catch (err) {
      setError(adminErrorMessage(err, 'Failed to load members'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    // Reset all per-team UI state so a team swap can't carry a dialog or picker
    // selection (or an in-flight read) from the previous team into this one.
    setAddUserId('')
    setRemoveTarget(null)
    setRolesTarget(null)
    setLoading(true)
    setError(null)
    listMembers(teamId)
      .then((data) => {
        if (active) setMembers(data)
      })
      .catch((err) => {
        if (active) setError(adminErrorMessage(err, 'Failed to load members'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [teamId])

  useEffect(() => {
    // Role catalog + user directory are team-independent — load once.
    listRoles()
      .then(setRoles)
      .catch(() => setRoles([]))
    listUsers()
      .then(setUsers)
      .catch(() => setUsers([]))
  }, [])

  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? id
  const nonMembers = users.filter((u) => !members.some((m) => m.userId === u.id))

  const handleAdd = async () => {
    if (!addUserId) return
    setAdding(true)
    try {
      await addMember(teamId, addUserId)
      toast.success(`Added member to ${teamName}`)
      setAddUserId('')
      await fetchMembers()
      onMembershipChanged()
    } catch (err) {
      toast.error(adminErrorMessage(err, 'Failed to add member'))
    } finally {
      setAdding(false)
    }
  }

  const handleRemove = async () => {
    if (!removeTarget) return
    setRemoving(true)
    try {
      await removeMember(teamId, removeTarget.userId)
      toast.success(`Removed ${removeTarget.email} from ${teamName}`)
      setRemoveTarget(null)
      await fetchMembers()
      onMembershipChanged()
    } catch (err) {
      toast.error(adminErrorMessage(err, 'Failed to remove member'))
    } finally {
      setRemoving(false)
    }
  }

  const openRolesEditor = (member: TeamMember) => setRolesTarget(member)

  const handleSaveRoles = async (roleIds: string[]) => {
    if (!rolesTarget) return
    setSavingRoles(true)
    try {
      await setMemberRoles(teamId, rolesTarget.userId, roleIds)
      toast.success(`Roles updated for ${rolesTarget.email}`)
      setRolesTarget(null)
      await fetchMembers()
    } catch (err) {
      toast.error(adminErrorMessage(err, 'Failed to save roles'))
    } finally {
      setSavingRoles(false)
    }
  }

  return (
    <>
      <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Members of {teamName}</h3>

        <div className="flex items-center gap-2">
          <select
            aria-label="Add member"
            value={addUserId}
            disabled={adding}
            onChange={(e) => setAddUserId(e.target.value)}
            className="h-8 flex-1 rounded-md border border-slate-200 dark:border-slate-700 bg-transparent px-2 text-sm"
          >
            <option value="">Select a user to add…</option>
            {nonMembers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name ? `${u.name} (${u.email})` : u.email}
              </option>
            ))}
          </select>
          <Button size="sm" onClick={handleAdd} disabled={!addUserId || adding}>
            {adding ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <UserPlus className="h-4 w-4 mr-2" />}
            Add
          </Button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {error && <div className="text-sm text-destructive py-2 text-center">{error}</div>}

        {!loading && !error && (
          <div className="space-y-1">
            {members.map((m) => (
              <div
                key={m.userId}
                className="flex items-center gap-3 rounded-md border border-slate-100 dark:border-slate-800 px-3 py-2"
              >
                <div className="min-w-0 flex-shrink-0 w-48">
                  <div className="text-sm font-medium truncate">{m.name || '(no name)'}</div>
                  <div className="text-xs text-muted-foreground truncate">{m.email}</div>
                </div>
                <div className="flex flex-wrap gap-1 flex-1">
                  {m.roleIds.length > 0 ? (
                    m.roleIds.map((rid) => (
                      <Badge key={rid} variant="secondary">
                        {roleName(rid)}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">Viewer (no roles)</span>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-shrink-0"
                  title={`Set roles for ${m.email}`}
                  onClick={() => openRolesEditor(m)}
                >
                  <Pencil className="h-3.5 w-3.5 mr-1.5" />
                  Set Roles
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 flex-shrink-0 text-muted-foreground hover:text-destructive"
                  title={`Remove ${m.email}`}
                  onClick={() => setRemoveTarget(m)}
                >
                  <UserMinus className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {members.length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-2">No members yet.</div>
            )}
          </div>
        )}
      </div>

      {/* Remove member dialog */}
      <AlertDialog open={!!removeTarget} onOpenChange={(v) => !v && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove member?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">{removeTarget?.email}</span> loses visibility of all
              libraries owned by {teamName}, and their role assignments in this team are revoked.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleRemove} disabled={removing}>
              {removing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Removing...
                </>
              ) : (
                'Remove'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RoleAssignmentDialog
        key={rolesTarget?.userId ?? 'none'}
        open={!!rolesTarget}
        onOpenChange={(v) => !v && setRolesTarget(null)}
        userEmail={rolesTarget?.email ?? ''}
        teamName={teamName}
        allRoles={roles}
        initialRoleIds={rolesTarget?.roleIds ?? []}
        saving={savingRoles}
        onSave={handleSaveRoles}
      />
    </>
  )
}
