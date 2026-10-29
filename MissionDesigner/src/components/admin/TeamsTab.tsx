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

// Team CRUD (design §12 Phase 4). Selecting a team reveals its members panel.
// Deleting a team that still owns libraries is refused by the server with
// 409 team_not_empty — surfaced as a toast, never attempted client-side.

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
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
  cn,
} from '@mission/ui'
import {
  adminErrorMessage,
  createTeam,
  deleteTeam,
  listTeams,
  patchTeam,
  type TeamWithCounts,
} from '@/lib/admin/adminClient'
import { TeamMembersPanel } from './teams/TeamMembersPanel'

export function TeamsTab() {
  const [teams, setTeams] = useState<TeamWithCounts[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<TeamWithCounts | null>(null)
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<TeamWithCounts | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchTeams = async () => {
    setLoading(true)
    setError(null)
    try {
      setTeams(await listTeams())
    } catch (err) {
      setError(adminErrorMessage(err, 'Failed to load teams'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTeams()
  }, [])

  const openCreate = () => {
    setEditTarget(null)
    setFormName('')
    setFormDescription('')
    setFormOpen(true)
  }

  const openEdit = (team: TeamWithCounts) => {
    setEditTarget(team)
    setFormName(team.name)
    setFormDescription(team.description ?? '')
    setFormOpen(true)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      if (editTarget) {
        await patchTeam(editTarget.id, { name: formName, description: formDescription || null })
        toast.success('Team updated')
      } else {
        await createTeam({ name: formName, description: formDescription || undefined })
        toast.success('Team created')
      }
      setFormOpen(false)
      fetchTeams()
    } catch (err) {
      toast.error(adminErrorMessage(err, 'Failed to save team'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteTeam(deleteTarget.id)
      toast.success(`Deleted team: ${deleteTarget.name}`)
      if (selectedTeamId === deleteTarget.id) setSelectedTeamId(null)
      setDeleteTarget(null)
      fetchTeams()
    } catch (err) {
      toast.error(adminErrorMessage(err, 'Failed to delete team'))
    } finally {
      setDeleting(false)
    }
  }

  const selectedTeam = teams.find((t) => t.id === selectedTeamId) ?? null

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Teams</h2>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" />
            New Team
          </Button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && <div className="text-sm text-destructive py-4 text-center">{error}</div>}

        {!loading && !error && (
          <div className="space-y-1">
            {teams.map((team) => (
              <div
                key={team.id}
                onClick={() => setSelectedTeamId(team.id === selectedTeamId ? null : team.id)}
                className={cn(
                  'flex items-center gap-3 rounded-md border px-3 py-2 cursor-pointer',
                  team.id === selectedTeamId
                    ? 'border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-950/30'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{team.name}</div>
                  {team.description && <div className="text-xs text-muted-foreground truncate">{team.description}</div>}
                </div>
                <span className="text-xs text-muted-foreground flex-shrink-0">
                  {team.memberCount} member{team.memberCount === 1 ? '' : 's'}
                </span>
                <span className="text-xs text-muted-foreground flex-shrink-0">
                  {team.libraryCount} librar{team.libraryCount === 1 ? 'y' : 'ies'}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 flex-shrink-0"
                  title={`Edit ${team.name}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    openEdit(team)
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 flex-shrink-0 text-muted-foreground hover:text-destructive"
                  title={`Delete ${team.name}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteTarget(team)
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {teams.length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-4">No teams defined.</div>
            )}
          </div>
        )}

        {selectedTeam && (
          <TeamMembersPanel teamId={selectedTeam.id} teamName={selectedTeam.name} onMembershipChanged={fetchTeams} />
        )}
      </div>

      {/* Create / edit team dialog */}
      <Dialog open={formOpen} onOpenChange={(v) => !saving && setFormOpen(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editTarget ? `Edit team: ${editTarget.name}` : 'New team'}</DialogTitle>
            <DialogDescription>
              {editTarget
                ? 'Update the team name and description.'
                : 'Provide a name and optional description for the new team.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="team-name">Name</Label>
              <Input id="team-name" value={formName} onChange={(e) => setFormName(e.target.value)} disabled={saving} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="team-description">Description</Label>
              <Textarea
                id="team-description"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                rows={2}
                disabled={saving}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || formName.trim().length === 0}>
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

      {/* Delete team dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete team?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes <span className="font-medium text-foreground">{deleteTarget?.name}</span>.
              Memberships and role assignments are removed with it. A team that still owns libraries cannot be deleted —
              move or delete its libraries first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
