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

import { useState, useEffect, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { signOut } from '@/lib/auth-client'
import { useLibraryStore } from '@/stores/libraryStore'
import { useFlowStore } from '@/stores/flowStore'
import { usePrincipalStore } from '@/stores/principalStore'
import { listUsers, setUserAdmin, deleteUser, adminErrorMessage, type UserAccount } from '@/lib/admin/adminClient'
import { Trash2, Loader2, Save, Download, Upload, AlertTriangle, UserPlus, KeyRound } from 'lucide-react'
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
  cn,
} from '@mission/ui'
import { AccountTeamsPanel } from './accounts/AccountTeamsPanel'
import { AddAccountDialog } from './accounts/AddAccountDialog'
import { SetPasswordDialog } from './accounts/SetPasswordDialog'

type RoleFields = {
  isAdministrator: boolean
}

type UserRecord = UserAccount

const ROLE_LABELS: { key: keyof RoleFields; label: string }[] = [{ key: 'isAdministrator', label: 'Admin' }]

/** What POST /api/backup/inspect reports about a file before anything is replaced. */
type BackupInspection = { version: number; signature: 'match' | 'mismatch'; counts: Record<string, number> }
type RestoreResult = { counts: Record<string, number>; warnings: string[] }

const OLDER_BACKUP_TEXT =
  'This backup was made by an older Designer. Spec states, version history, images and links are not in it and will be lost.'
const FOREIGN_BACKUP_TEXT =
  'This backup was not made by this Designer, or it was changed after it was made. Restore it only if you trust where it came from.'

/** Error text from a failed response. A proxy or body limit can answer with plain text, so never assume JSON. */
async function responseErrorMessage(res: Response, fallback: string): Promise<string> {
  let text = ''
  try {
    text = await res.text()
  } catch {
    /* unreadable body: fall through to the generic message */
  }
  try {
    const parsed = JSON.parse(text) as { message?: unknown; error?: unknown }
    if (typeof parsed.message === 'string' && parsed.message) return parsed.message
    if (typeof parsed.error === 'string' && parsed.error) return parsed.error
  } catch {
    /* not JSON */
  }
  const plain = text.trim()
  if (plain && plain.length <= 200 && !plain.startsWith('<')) return `${fallback} (HTTP ${res.status}): ${plain}`
  if (res.status === 413) return `The server refused the file (HTTP 413).`
  return `${fallback} (HTTP ${res.status}).`
}

function CountList({ counts }: { counts: Record<string, number> }) {
  return (
    <ul className="grid grid-cols-2 gap-x-4 text-sm">
      {Object.entries(counts).map(([table, n]) => (
        <li key={table} className="flex justify-between gap-2">
          <span>{table.replace(/_/g, ' ')}</span>
          <span className="font-medium text-foreground">{n}</span>
        </li>
      ))}
    </ul>
  )
}

export function AccountsTab({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<UserRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<UserRecord | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [passwordTarget, setPasswordTarget] = useState<UserRecord | null>(null)
  const [saving, setSaving] = useState(false)
  const [edits, setEdits] = useState<Map<string, Partial<RoleFields>>>(new Map())
  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [inspection, setInspection] = useState<BackupInspection | null>(null)
  const [confirmForeign, setConfirmForeign] = useState(false)
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [showClearWorkflowsConfirm, setShowClearWorkflowsConfirm] = useState(false)
  const [showAddAccount, setShowAddAccount] = useState(false)
  const [clearingWorkflows, setClearingWorkflows] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  const fetchUsers = async () => {
    setLoading(true)
    setError(null)
    try {
      setUsers(await listUsers())
      setEdits(new Map())
    } catch (err) {
      setError(adminErrorMessage(err, 'Failed to fetch users'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchUsers()
  }, [])

  const hasEdits = edits.size > 0

  const wouldHaveAdmin = users.some((u) => {
    const userEdits = edits.get(u.id)
    if (userEdits && 'isAdministrator' in userEdits) {
      return userEdits.isAdministrator === true
    }
    return u.isAdministrator === true
  })
  const noAdminAfterSave = hasEdits && !wouldHaveAdmin

  const getRoleValue = (u: UserRecord, key: keyof RoleFields): boolean => {
    const userEdits = edits.get(u.id)
    if (userEdits && key in userEdits) {
      return userEdits[key]!
    }
    return u[key] ?? false
  }

  const handleRoleToggle = (userId: string, key: keyof RoleFields, currentValue: boolean) => {
    setEdits((prev) => {
      const next = new Map(prev)
      const existing = next.get(userId) || {}
      const userRecord = users.find((u) => u.id === userId)
      if (!userRecord) return prev

      const originalValue = userRecord[key] ?? false
      const newValue = !currentValue

      if (newValue === originalValue) {
        const { [key]: _, ...rest } = existing
        if (Object.keys(rest).length === 0) {
          next.delete(userId)
        } else {
          next.set(userId, rest)
        }
      } else {
        next.set(userId, { ...existing, [key]: newValue })
      }
      return next
    })
  }

  const handleSave = async () => {
    if (!hasEdits) return
    setSaving(true)
    try {
      const entries = Array.from(edits.entries())
      const results = await Promise.allSettled(
        entries.map(([userId, fields]) => setUserAdmin(userId, fields.isAdministrator!)),
      )
      const failures = results.filter((r) => r.status === 'rejected')
      if (failures.length > 0) {
        const firstErr = (failures[0] as PromiseRejectedResult).reason
        toast.error(adminErrorMessage(firstErr, `Failed to update ${failures.length} user(s)`))
      } else {
        toast.success('Roles saved')
      }
      await fetchUsers()
    } catch (err) {
      toast.error(adminErrorMessage(err, 'Failed to save roles'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteUser(deleteTarget.id)
      toast.success(`Deleted account: ${deleteTarget.name || deleteTarget.email}`)
      if (selectedUserId === deleteTarget.id) setSelectedUserId(null)
      setDeleteTarget(null)
      fetchUsers()
    } catch (err) {
      toast.error(adminErrorMessage(err, 'Failed to delete user'))
    } finally {
      setDeleting(false)
    }
  }

  const handleBackup = async () => {
    try {
      const res = await fetch('/api/backup', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to create backup')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const date = new Date().toISOString().slice(0, 10)
      a.href = url
      a.download = `trajectory-backup-${date}.bpbackup`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Backup downloaded')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Backup failed')
    }
  }

  const resetRestore = () => {
    setRestoreFile(null)
    setInspection(null)
    setConfirmForeign(false)
  }

  // Inspect first: the confirm dialog shows what the file holds and whether it can be trusted.
  const handleRestoreFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const res = await fetch('/api/backup/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        credentials: 'include',
        body: await file.arrayBuffer(),
      })
      if (!res.ok) {
        throw new Error(await responseErrorMessage(res, 'Could not read the backup file'))
      }
      setInspection((await res.json()) as BackupInspection)
      setRestoreFile(file)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not read the backup file')
    }
  }

  const handleRestoreConfirm = async () => {
    if (!restoreFile || !inspection) return
    setRestoring(true)
    try {
      const arrayBuffer = await restoreFile.arrayBuffer()
      const query = inspection.signature === 'mismatch' ? '?acceptForeignSignature=1' : ''
      const res = await fetch(`/api/backup/restore${query}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        credentials: 'include',
        body: arrayBuffer,
      })
      if (!res.ok) {
        throw new Error(await responseErrorMessage(res, 'Restore failed'))
      }
      const result = (await res.json()) as { counts?: Record<string, number>; warnings?: string[] }
      resetRestore()
      setRestoreResult({ counts: result.counts ?? {}, warnings: result.warnings ?? [] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Restore failed')
    } finally {
      setRestoring(false)
    }
  }

  const handleClearWorkflows = async () => {
    setClearingWorkflows(true)
    try {
      const res = await fetch('/api/backup/clear-workflows', {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) {
        throw new Error(await responseErrorMessage(res, 'Clear workflows failed'))
      }
      const result = (await res.json()) as { counts: { specifications: number; libraries: number } }
      useLibraryStore.setState({
        libraries: [],
        specifications: new Map(),
        childLibraries: new Map(),
        selectedLibraryId: null,
        selectedSpecificationId: null,
        searchQuery: '',
      })
      useFlowStore.setState({
        nodes: [],
        edges: [],
        workflowInputs: [],
        workflowOutputs: [],
        workflowValues: [],
        workflowResources: [],
        hasDraft: false,
        draftAt: null,
      })
      toast.success(`Cleared ${result.counts.libraries} libraries and ${result.counts.specifications} workflows`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Clear workflows failed')
    } finally {
      setClearingWorkflows(false)
      setShowClearWorkflowsConfirm(false)
    }
  }

  /** Sign out, drop everything held for the old session, and go to the login page. */
  const endSession = async () => {
    await signOut()
    usePrincipalStore.getState().clearPrincipal()
    useLibraryStore.setState({
      libraries: [],
      specifications: new Map(),
      childLibraries: new Map(),
      selectedLibraryId: null,
      selectedSpecificationId: null,
      searchQuery: '',
    })
    useFlowStore.setState({
      nodes: [],
      edges: [],
      workflowInputs: [],
      workflowOutputs: [],
      workflowValues: [],
      workflowResources: [],
      hasDraft: false,
      draftAt: null,
    })
    sessionStorage.removeItem('library-ui-state')
    navigate({ to: '/login' })
  }

  const handleClearDatabase = async () => {
    setClearing(true)
    try {
      const res = await fetch('/api/backup/clear', {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) {
        throw new Error(await responseErrorMessage(res, 'Clear failed'))
      }
      await endSession()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Clear database failed')
    } finally {
      setClearing(false)
      setShowClearConfirm(false)
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '\u2014'
    return new Date(dateStr).toLocaleDateString()
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">User Accounts</h2>
          <div className="flex items-center gap-3">
            <Button onClick={() => setShowAddAccount(true)} size="sm" variant="outline">
              <UserPlus className="h-4 w-4 mr-2" />
              Add Account
            </Button>
            {noAdminAfterSave && <span className="text-xs text-destructive">At least one user must be an Admin</span>}
            <Button onClick={handleSave} disabled={!hasEdits || saving || noAdminAfterSave} size="sm">
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Roles
                </>
              )}
            </Button>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && <div className="text-sm text-destructive py-4 text-center">{error}</div>}

        {!loading && !error && (
          <div className="space-y-1">
            {users.map((u) => (
              <div
                key={u.id}
                onClick={() => setSelectedUserId(u.id === selectedUserId ? null : u.id)}
                className={cn(
                  'flex items-center gap-3 rounded-md border px-3 py-2 cursor-pointer',
                  u.id === selectedUserId
                    ? 'border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-950/30'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900',
                )}
              >
                <div className="min-w-0 flex-shrink-0 w-44">
                  <div className="text-sm font-medium truncate">{u.name || '(no name)'}</div>
                  <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                  <div className="text-xs text-muted-foreground">Joined {formatDate(u.createdAt)}</div>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 flex-1">
                  {ROLE_LABELS.map(({ key, label }) => (
                    <label
                      key={key}
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 text-xs cursor-pointer select-none"
                    >
                      <input
                        type="checkbox"
                        checked={getRoleValue(u, key)}
                        disabled={saving}
                        onChange={() => handleRoleToggle(u.id, key, getRoleValue(u, key))}
                        onClick={(e) => e.stopPropagation()}
                        className="h-3.5 w-3.5 rounded border-gray-300 text-primary accent-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 flex-shrink-0 text-muted-foreground"
                  disabled={saving}
                  title={`Set password for ${u.name || u.email}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    setPasswordTarget(u)
                  }}
                >
                  <KeyRound className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 flex-shrink-0 text-muted-foreground hover:text-destructive"
                  disabled={u.id === currentUserId || saving}
                  title={u.id === currentUserId ? 'Cannot delete your own account' : `Delete ${u.name || u.email}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteTarget(u)
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {users.length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-4">No accounts found.</div>
            )}
          </div>
        )}

        {selectedUserId && (
          <AccountTeamsPanel
            userId={selectedUserId}
            userEmail={users.find((u) => u.id === selectedUserId)?.email ?? ''}
            onMembershipChanged={fetchUsers}
          />
        )}

        {/* Database management section */}
        <div className="border-t border-slate-200 dark:border-slate-700 pt-6">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">Database Management</h3>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={handleBackup}>
              <Download className="h-4 w-4 mr-2" />
              Backup Database
            </Button>
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4 mr-2" />
              Restore Database
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowClearWorkflowsConfirm(true)}>
              <Trash2 className="h-4 w-4 mr-2" />
              Clear Workflows
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setShowClearConfirm(true)}>
              <Trash2 className="h-4 w-4 mr-2" />
              Clear Database
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".bpbackup"
              className="hidden"
              onChange={handleRestoreFileSelected}
            />
          </div>
        </div>
      </div>

      <AddAccountDialog
        open={showAddAccount}
        onOpenChange={setShowAddAccount}
        onCreated={(u) => {
          toast.success(`Created account: ${u.email}`)
          fetchUsers()
        }}
      />

      <SetPasswordDialog
        open={!!passwordTarget}
        onOpenChange={(v) => !v && setPasswordTarget(null)}
        userId={passwordTarget?.id ?? ''}
        userLabel={passwordTarget?.name || passwordTarget?.email || ''}
        isSelf={!!passwordTarget && passwordTarget.id === currentUserId}
        onDone={async () => {
          const wasSelf = passwordTarget?.id === currentUserId
          setPasswordTarget(null)
          if (!wasSelf) return
          try {
            await endSession()
          } catch (err) {
            // The password is changed and the session revoked either way: show the error, still sign in again.
            toast.error(err instanceof Error ? err.message : 'Sign-out failed')
            navigate({ to: '/login' })
          }
        }}
      />

      {/* Delete user dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete account?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete{' '}
              <span className="font-medium text-foreground">{deleteTarget?.name || deleteTarget?.email}</span>
              's account and all their libraries and workflows. This action cannot be undone.
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

      {/* Restore dialog: what the file holds, and a warning for an older or foreign file */}
      <AlertDialog open={!!inspection && !confirmForeign} onOpenChange={(v) => !v && !restoring && resetRestore()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore from backup?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  This will replace all libraries, specifications, and user data with the contents of{' '}
                  <span className="font-medium text-foreground">{restoreFile?.name}</span>. This action cannot be
                  undone.
                </p>
                {inspection && <CountList counts={inspection.counts} />}
                {inspection && inspection.version < 3 && (
                  <p className="text-amber-700 dark:text-amber-300">{OLDER_BACKUP_TEXT}</p>
                )}
                {inspection?.signature === 'mismatch' && <p className="text-destructive">{FOREIGN_BACKUP_TEXT}</p>}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={restoring}
              onClick={(e) => {
                e.preventDefault()
                if (inspection?.signature === 'mismatch') setConfirmForeign(true)
                else handleRestoreConfirm()
              }}
            >
              {restoring ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Restoring...
                </>
              ) : inspection?.signature === 'mismatch' ? (
                'Restore anyway'
              ) : (
                'Restore'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Second confirmation for a file signed by another install */}
      <AlertDialog open={!!inspection && confirmForeign} onOpenChange={(v) => !v && !restoring && resetRestore()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Are you sure?
            </AlertDialogTitle>
            <AlertDialogDescription>{FOREIGN_BACKUP_TEXT}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={restoring}
              onClick={(e) => {
                e.preventDefault()
                handleRestoreConfirm()
              }}
            >
              {restoring ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Restoring...
                </>
              ) : (
                'Restore anyway'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Restore result: rows per table and every warning; closing reloads the app */}
      <AlertDialog open={!!restoreResult}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Backup restored</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {restoreResult && <CountList counts={restoreResult.counts} />}
                {restoreResult && restoreResult.warnings.length > 0 && (
                  <div>
                    <p className="font-medium text-foreground">
                      {restoreResult.warnings.length} warning{restoreResult.warnings.length === 1 ? '' : 's'}
                    </p>
                    <ul className="list-disc pl-5 text-sm">
                      {restoreResult.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => window.location.reload()}>Close</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Clear workflows dialog */}
      <AlertDialog open={showClearWorkflowsConfirm} onOpenChange={setShowClearWorkflowsConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Clear All Workflows?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all libraries and workflow specifications. User accounts will be preserved.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearingWorkflows}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleClearWorkflows} disabled={clearingWorkflows}>
              {clearingWorkflows ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Clearing...
                </>
              ) : (
                'Clear Workflows'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Clear database dialog */}
      <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Clear Entire Database?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <div className="p-3 rounded-md bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-sm text-red-700 dark:text-red-300">
                  <span className="font-semibold">WARNING:</span> This will permanently delete ALL data including all
                  user accounts, libraries, specifications, and workflows. There is no way to recover this data.
                </div>
                <p>
                  You will be logged out and returned to the login screen. The next account registered will become the
                  new administrator.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearing}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleClearDatabase} disabled={clearing}>
              {clearing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Clearing...
                </>
              ) : (
                'Clear Everything'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
