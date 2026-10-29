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
import { apiErrorMessage } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

// Unassigning also drops the user's per-work-center roles, so the dialog names them.
// onConfirm rejects on failure: this dialog toasts the error and STAYS OPEN for a retry;
// on success the caller closes it.
type UnassignUserDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userName: string;
  workCenterName: string;
  roleNames: string[];
  onConfirm: () => Promise<void>;
};

export function UnassignUserDialog({
  open, onOpenChange, userName, workCenterName, roleNames, onConfirm,
}: UnassignUserDialogProps) {
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Unassign failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Unassign {userName} from {workCenterName}?</DialogTitle>
          {roleNames.length > 0 && (
            <DialogDescription>
              Their roles in this work center will be removed too: {roleNames.join(', ')}.
            </DialogDescription>
          )}
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button type="button" variant="destructive" onClick={confirm} disabled={busy}>Unassign</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
