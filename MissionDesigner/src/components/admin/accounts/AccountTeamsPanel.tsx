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

// Account-centric mirror of TeamMembersPanel (design 2026-06-18): manage one
// person's team memberships (visibility) + per-team roles (capability). Mutations
// reuse the team-keyed endpoints; the role picker is the shared RoleAssignmentDialog.

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
  listRoles,
  listTeams,
  listUserMemberships,
  removeMember,
  setMemberRoles,
  type Role,
  type TeamWithCounts,
  type UserMembership,
} from '@/lib/admin/adminClient'
import { RoleAssignmentDialog } from '../roles/RoleAssignmentDialog'

interface AccountTeamsPanelProps {
  userId: string
  userEmail: string
  /** Add/remove changes a team's memberCount — let the parent refresh derived data. */
  onMembershipChanged: () => void
}

export function AccountTeamsPanel({ userId, userEmail, onMembershipChanged }: AccountTeamsPanelProps) {
  const [memberships, setMemberships] = useState<UserMembership[]>([])
  const [teams, setTeams] = useState<TeamWithCounts[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [addTeamId, setAddTeamId] = useState('')
  const [adding, setAdding] = useState(false)
  const [leaveTarget, setLeaveTarget] = useState<UserMembership | null>(null)
  const [leaving, setLeaving] = useState(false)
  const [rolesTarget, setRolesTarget] = useState<UserMembership | null>(null)
  const [savingRoles, setSavingRoles] = useState(false)

  const fetchMemberships = async () => {
    setLoading(true)
    setError(null)
    try {
      setMemberships(await listUserMemberships(userId))
    } catch (err) {
      setError(adminErrorMessage(err, 'Failed to load memberships'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    setAddTeamId('')
    setLeaveTarget(null)
    setRolesTarget(null)
    setLoading(true)
    setError(null)
    listUserMemberships(userId)
      .then((data) => {
        if (active) setMemberships(data)
      })
      .catch((err) => {
        if (active) setError(adminErrorMessage(err, 'Failed to load memberships'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [userId])

  useEffect(() => {
    listTeams()
      .then(setTeams)
      .catch(() => setTeams([]))
    listRoles()
      .then(setRoles)
      .catch(() => setRoles([]))
  }, [])

  const nonMemberTeams = teams.filter((t) => !memberships.some((m) => m.teamId === t.id))
  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? id

  const handleAdd = async () => {
    if (!addTeamId) return
    setAdding(true)
    try {
      await addMember(addTeamId, userId)
      toast.success('Added to team')
      setAddTeamId('')
      await fetchMemberships()
      onMembershipChanged()
    } catch (err) {
      toast.error(adminErrorMessage(err, 'Failed to add to team'))
    } finally {
      setAdding(false)
    }
  }

  const handleLeave = async () => {
    if (!leaveTarget) return
    setLeaving(true)
    try {
      await removeMember(leaveTarget.teamId, userId)
      toast.success(`Removed from ${leaveTarget.teamName}`)
      setLeaveTarget(null)
      await fetchMemberships()
      onMembershipChanged()
    } catch (err) {
      toast.error(adminErrorMessage(err, 'Failed to remove from team'))
    } finally {
      setLeaving(false)
    }
  }

  const handleSaveRoles = async (roleIds: string[]) => {
    if (!rolesTarget) return
    setSavingRoles(true)
    try {
      await setMemberRoles(rolesTarget.teamId, userId, roleIds)
      toast.success(`Roles updated for ${rolesTarget.teamName}`)
      setRolesTarget(null)
      await fetchMemberships()
    } catch (err) {
      toast.error(adminErrorMessage(err, 'Failed to save roles'))
    } finally {
      setSavingRoles(false)
    }
  }

  return (
    <>
      <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Teams &amp; roles for {userEmail}</h3>

        <div className="flex items-center gap-2">
          <select
            aria-label="Add to team"
            value={addTeamId}
            disabled={adding}
            onChange={(e) => setAddTeamId(e.target.value)}
            className="h-8 flex-1 rounded-md border border-slate-200 dark:border-slate-700 bg-transparent px-2 text-sm"
          >
            <option value="">Select a team to add…</option>
            {nonMemberTeams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <Button size="sm" onClick={handleAdd} disabled={!addTeamId || adding}>
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
            {memberships.map((m) => (
              <div
                key={m.teamId}
                className="flex items-center gap-3 rounded-md border border-slate-100 dark:border-slate-800 px-3 py-2"
              >
                <div className="min-w-0 flex-shrink-0 w-48">
                  <div className="text-sm font-medium truncate">{m.teamName}</div>
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
                  title={`Set roles in ${m.teamName}`}
                  onClick={() => setRolesTarget(m)}
                >
                  <Pencil className="h-3.5 w-3.5 mr-1.5" />
                  Set Roles
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 flex-shrink-0 text-muted-foreground hover:text-destructive"
                  title={`Remove from ${m.teamName}`}
                  onClick={() => setLeaveTarget(m)}
                >
                  <UserMinus className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {memberships.length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-2">Not a member of any team yet.</div>
            )}
          </div>
        )}
      </div>

      {/* Leave team dialog */}
      <AlertDialog open={!!leaveTarget} onOpenChange={(v) => !v && setLeaveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from {leaveTarget?.teamName}?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">{userEmail}</span> loses visibility of libraries owned by{' '}
              {leaveTarget?.teamName}, and their role assignments in that team are revoked.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={leaving}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleLeave} disabled={leaving}>
              {leaving ? (
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

      {/* Role assignment dialog (shared with TeamMembersPanel). key= remounts per team to re-seed the draft. */}
      <RoleAssignmentDialog
        key={rolesTarget?.teamId ?? 'none'}
        open={!!rolesTarget}
        onOpenChange={(v) => !v && setRolesTarget(null)}
        userEmail={userEmail}
        teamName={rolesTarget?.teamName ?? ''}
        allRoles={roles}
        initialRoleIds={rolesTarget?.roleIds ?? []}
        saving={savingRoles}
        onSave={handleSaveRoles}
      />
    </>
  )
}
