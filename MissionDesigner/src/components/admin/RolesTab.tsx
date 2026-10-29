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
} from '@mission/ui'
import { adminErrorMessage, deleteRole, getRole, listRoles, type Role } from '@/lib/admin/adminClient'
import { summarizeRights } from '@/lib/admin/rightsCatalog'
import { RoleEditorDialog } from './roles/RoleEditorDialog'
import { EditLockCard } from './roles/EditLockCard'

export function RolesTab() {
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Role | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchRoles = async () => {
    setLoading(true)
    setError(null)
    try {
      setRoles(await listRoles())
    } catch (err) {
      setError(adminErrorMessage(err, 'Failed to load roles'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchRoles()
  }, [])

  const openDelete = async (role: Role) => {
    setDeleteTarget(role)
    try {
      // Fresh count — the list may be stale (assignments change on the Teams tab).
      const fresh = await getRole(role.id)
      // Only apply if the dialog is still open for this same role — a late read
      // must not reopen a dialog the user already cancelled/confirmed, nor clobber
      // a different role's dialog.
      setDeleteTarget((current) => (current?.id === role.id ? fresh : current))
    } catch {
      // keep the list row's count if the fresh read fails
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteRole(deleteTarget.id)
      toast.success(`Deleted role: ${deleteTarget.name}`)
      setDeleteTarget(null)
      fetchRoles()
    } catch (err) {
      toast.error(adminErrorMessage(err, 'Failed to delete role'))
    } finally {
      setDeleting(false)
    }
  }

  const deleteCount = deleteTarget?.assignmentCount ?? 0

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Roles</h2>
          <Button
            size="sm"
            onClick={() => {
              setEditTarget(null)
              setEditorOpen(true)
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            New Role
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
            {roles.map((role) => (
              <div
                key={role.id}
                className="flex items-center gap-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{role.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {role.assignmentCount} assignment{role.assignmentCount === 1 ? '' : 's'}
                    </span>
                  </div>
                  {role.description && <div className="text-xs text-muted-foreground truncate">{role.description}</div>}
                  <div className="text-xs text-muted-foreground truncate">
                    {role.rights.length > 0 ? summarizeRights(role.rights) : 'No rights (viewer-equivalent)'}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 flex-shrink-0"
                  title={`Edit ${role.name}`}
                  onClick={() => {
                    setEditTarget(role)
                    setEditorOpen(true)
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 flex-shrink-0 text-muted-foreground hover:text-destructive"
                  title={`Delete ${role.name}`}
                  onClick={() => openDelete(role)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {roles.length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-4">No roles defined.</div>
            )}
          </div>
        )}

        <EditLockCard />
      </div>

      <RoleEditorDialog open={editorOpen} onOpenChange={setEditorOpen} initial={editTarget} onSaved={fetchRoles} />

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete role?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes <span className="font-medium text-foreground">{deleteTarget?.name}</span> and
              revokes {deleteCount} assignment{deleteCount === 1 ? '' : 's'} across all teams. Affected users lose those
              rights immediately.
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
