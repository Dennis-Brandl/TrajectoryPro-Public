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
import { workCenters } from '@/lib/api/work-centers';
import { ApiError, apiErrorMessage } from '@/lib/api/client';
import type { DeleteImpact, WorkCenter } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

// There is no AlertDialog primitive, so this composes the base Dialog with a
// destructive-styled confirm.
//
// M6 made this a TWO-CALL delete (spec §8.1): destroying a work center destroys every
// artifact loaded into it AND all of its execution history, so the first DELETE never
// destroys anything — it 409s with an impact summary, which this dialog renders before
// offering "Delete anyway" (the same DELETE with ?confirm=true).
type DeleteWorkCenterDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workCenter: WorkCenter;
  onDeleted: () => void;
};

// The 409 body is { error: { code, message, impact } }. Narrowed defensively: a server that
// answers 409 WITHOUT an impact (an older build, or a different conflict such as
// WORK_CENTER_HAS_CHILDREN) must fall through to the plain toast rather than render an
// empty summary.
function impactOf(err: unknown): DeleteImpact | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const impact = (err.body as { error?: { impact?: DeleteImpact } } | undefined)?.error?.impact;
  return impact && typeof impact.workflows === 'number' ? impact : null;
}

export function DeleteWorkCenterDialog({ open, onOpenChange, workCenter, onDeleted }: DeleteWorkCenterDialogProps) {
  const [busy, setBusy] = useState(false);
  const [impact, setImpact] = useState<DeleteImpact | null>(null);

  // A reopen must start from the preflight again — otherwise a stale summary from a previous
  // attempt would offer "Delete anyway" for a work center the user has since emptied.
  useEffect(() => { if (!open) setImpact(null); }, [open]);

  const run = async (confirm: boolean) => {
    setBusy(true);
    try {
      await workCenters.remove(workCenter.id, confirm);
      toast.success('Work center deleted');
      onDeleted();
      onOpenChange(false);
    } catch (err) {
      const summary = impactOf(err);
      if (summary) {
        // The refusal is the expected first answer, not an error — show what a confirmed
        // delete would destroy instead of a bare toast.
        setImpact(summary);
      } else {
        // Anything else keeps the dialog open so the user can resolve it and retry.
        toast.error(apiErrorMessage(err, 'Delete blocked'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete work center?</DialogTitle>
          <DialogDescription>
            This permanently removes “{workCenter.name}”. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {impact && (
          <div className="rounded border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <div className="font-medium text-destructive">This work center is not empty</div>
            <ul className="mt-1 space-y-0.5">
              <li>{impact.workflows} workflows</li>
              <li>{impact.environments} environment specs</li>
              <li>{impact.instances} runtime instances ({impact.stepInstances} step instances)</li>
              <li>{impact.schedules} schedules</li>
            </ul>
            <p className="mt-2 text-muted-foreground">
              Deleting anyway destroys all of the above, including execution history.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          {impact ? (
            // Children block regardless of confirmation (spec §8.3), so this is deliberately
            // NOT offered for them — the server would refuse it and the button would lie.
            impact.hasChildren ? null : (
              <Button type="button" variant="destructive" onClick={() => run(true)} disabled={busy}>Delete anyway</Button>
            )
          ) : (
            <Button type="button" variant="destructive" onClick={() => run(false)} disabled={busy}>Delete</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
