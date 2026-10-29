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

// Administrator password reset (also the way to give a restored, password-less
// account its first password). The server revokes the target's sessions.

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
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
import { adminErrorMessage, setUserPassword } from '@/lib/admin/adminClient'

interface SetPasswordDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId: string
  userLabel: string
  /** The account being changed is the signed-in one: its session is revoked too. */
  isSelf: boolean
  onDone: () => void
}

export function SetPasswordDialog({ open, onOpenChange, userId, userLabel, isSelf, onDone }: SetPasswordDialogProps) {
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setPw('')
      setConfirm('')
      setErr(null)
      setBusy(false)
    }
  }, [open])

  const submit = async () => {
    if (pw.length < 8) {
      setErr('Password must be at least 8 characters')
      return
    }
    if (pw !== confirm) {
      setErr('Passwords do not match')
      return
    }
    setErr(null)
    setBusy(true)
    try {
      await setUserPassword(userId, pw)
      toast.success(
        isSelf
          ? 'Password changed — sign in with your new password'
          : 'Password set — the user was signed out everywhere',
      )
      onDone()
      onOpenChange(false)
    } catch (e) {
      toast.error(adminErrorMessage(e, 'Set password failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set password</DialogTitle>
          <DialogDescription>
            Setting a new password signs the user out of all active sessions.
            {userLabel ? ` Account: ${userLabel}` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="set-pw-new">New password</Label>
            <Input id="set-pw-new" type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="set-pw-confirm">Confirm password</Label>
            <Input id="set-pw-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={busy}>
            Set password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
