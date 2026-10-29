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
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { users } from '@/lib/api/users';
import { apiErrorMessage } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

// Admin password reset. Uses the app's own /api/users/:id/password route (users.setPassword),
// NOT the better-auth admin client — the external set-user-password endpoint is blocked
// (spec §6.3); our route additionally revokes the target's sessions server-side.
export function SetPasswordDialog({ open, onOpenChange, userId, onDone }:
  { open: boolean; onOpenChange: (o: boolean) => void; userId: string; onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setPw(''); setConfirm(''); setErr(null); setBusy(false); } }, [open]);

  const submit = async () => {
    if (pw.length < 8) { setErr('Password must be at least 8 characters'); return; }
    if (pw !== confirm) { setErr('Passwords do not match'); return; }
    setErr(null); setBusy(true);
    try { await users.setPassword(userId, pw); toast.success('Password set — the user was signed out everywhere'); onDone(); onOpenChange(false); }
    catch (e) { toast.error(apiErrorMessage(e, 'Set password failed')); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set password</DialogTitle>
          <DialogDescription>Setting a new password signs the user out of all active sessions.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="new-pw">New password</Label>
            <Input id="new-pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="confirm-pw">Confirm password</Label>
            <Input id="confirm-pw" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button type="button" onClick={submit} disabled={busy}>Set password</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
