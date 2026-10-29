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
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { runtimeWorkflows } from '@/lib/api/runtime-workflows';
import { apiErrorMessage } from '@/lib/api/client';
import type { AssignmentCandidatesView } from '@/lib/api/types';

// Commander assign picker (spec 2026-08-27 §4.6). Presence is SHOWN but never required —
// assigning to an away/offline member is a legitimate override; the claim waits for them.
// The candidates list is advisory: the engine re-validates at write time and 409s a race.
export function AssignClaimDialog({ assignmentId, stepName, onClose, onAssigned }: {
  assignmentId: string; stepName: string; onClose: () => void; onAssigned: () => void;
}) {
  const [view, setView] = useState<AssignmentCandidatesView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    const id = ++reqId.current;
    setView(null); setLoadError(null);
    runtimeWorkflows.candidates(assignmentId).then(
      (v) => { if (reqId.current === id) setView(v); },
      (err) => { if (reqId.current === id) setLoadError(apiErrorMessage(err, 'Failed to load candidates')); },
    );
  }, [assignmentId]);

  const assign = async (userId: string) => {
    setBusy(true);
    try {
      await runtimeWorkflows.assign(assignmentId, userId);
      toast.success(`Assigned “${stepName}”`);
      onAssigned();
      onClose();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Assign failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign “{stepName}”</DialogTitle>
          <DialogDescription>Pick a work-center member to claim this step for.</DialogDescription>
        </DialogHeader>
        {view === null && loadError === null && <p className="text-sm text-muted-foreground">Loading…</p>}
        {loadError && <p className="text-sm text-destructive">{loadError}</p>}
        {view && view.candidates.length === 0 && (
          <p className="text-sm text-muted-foreground">No eligible members in this work center.</p>
        )}
        {view && view.candidates.length > 0 && (
          <div className="flex flex-col gap-1">
            {view.candidates.map((u) => (
              <Button key={u.userId} type="button" variant="ghost" size="sm" disabled={busy}
                className="justify-start gap-2" onClick={() => void assign(u.userId)}>
                <span aria-hidden className={`size-2 shrink-0 rounded-full ${u.presence === 'online' ? 'bg-emerald-500' : u.presence === 'away' ? 'bg-amber-500' : 'bg-muted-foreground'}`} />
                <span className="truncate">{u.name ?? u.userId}</span>
                <span className="sr-only">({u.presence})</span>
              </Button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
