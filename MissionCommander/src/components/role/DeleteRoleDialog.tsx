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
import { useState } from 'react';
import { toast } from 'sonner';
import { roles } from '@/lib/api/roles';
import { apiErrorMessage } from '@/lib/api/client';
import type { Role } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

// There is no AlertDialog primitive, so this composes the base Dialog with a
// destructive-styled confirm. `work_center_user_role.role_id` is ON DELETE CASCADE
// server-side, so a confirmed delete silently drops every per-work-center membership
// row — the dialog copy below says so up front. On a server 409 (ROLE_IN_USE /
// SYSTEM_ROLE) the dialog STAYS OPEN and surfaces the server's message via toast.
type DeleteRoleDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: Role;
  onDeleted: () => void;
};

export function DeleteRoleDialog({ open, onOpenChange, role, onDeleted }: DeleteRoleDialogProps) {
  const [busy, setBusy] = useState(false);

  const onConfirm = async () => {
    setBusy(true);
    try {
      await roles.remove(role.id);
      toast.success('Role deleted');
      onDeleted();
      onOpenChange(false);
    } catch (err) {
      // 409 names the blocker (ROLE_IN_USE / SYSTEM_ROLE) — keep the dialog open so the
      // user can resolve it and retry.
      toast.error(apiErrorMessage(err, 'Delete blocked'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete role?</DialogTitle>
          <DialogDescription>
            This permanently removes “{role.name}” and unassigns it from every work-center member who holds it. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={busy}>Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
