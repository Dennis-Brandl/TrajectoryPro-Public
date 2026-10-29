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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

// One dialog for both artifact deletes (§14.7): identical but for the noun and the api
// call, which the caller supplies as onConfirm — so this never imports workflows/
// environments. There is no AlertDialog primitive, so this composes the base Dialog with a
// destructive confirm. workflows.remove/environments.remove (passed in as onConfirm) are
// RESTRICT-aware: a spec with runtime instances or schedules 409s, so the dialog STAYS
// OPEN and toasts the message.
export function DeleteSpecDialog({ open, onOpenChange, kind, name, onConfirm, onDeleted }:
  { open: boolean; onOpenChange: (o: boolean) => void; kind: 'workflow' | 'environment';
    name: string; onConfirm: () => Promise<unknown>; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const noun = kind === 'workflow' ? 'workflow' : 'environment spec';
  const onClick = async () => {
    setBusy(true);
    try {
      await onConfirm();
      toast.success(`Deleted ${name}`);
      onDeleted();
      onOpenChange(false);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Delete blocked'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {noun}?</DialogTitle>
          <DialogDescription>
            {/* M6 removed linking — the RESTRICT blockers today are unfinished runtimes and
                schedules (dao/workflows.ts deleteWorkflow), so the old "unlink it first"
                copy pointed at an affordance that no longer exists. Finished runtimes never
                block: a workflow's are deleted with it; an environment spec's lose their link. */}
            {kind === 'workflow'
              ? <>This permanently removes “{name}” and its finished runtime workflows (their records stay in History). If it has runtime workflows that are pending or still running, or schedules, the delete is blocked; finish or delete those first. This action cannot be undone.</>
              : <>This permanently removes “{name}”. Finished runtime workflows that used it are not affected (their records stay in History). If runtime workflows that are pending or still running use it, or schedules, the delete is blocked; finish or delete those first. This action cannot be undone.</>}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button type="button" variant="destructive" onClick={onClick} disabled={busy}>Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
