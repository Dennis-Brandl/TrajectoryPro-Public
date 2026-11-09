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
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { apiErrorMessage } from '@/lib/api/client';
import { runtimeHistory } from '@/lib/api/runtime-history';
import type { ScheduleHistoryDetail } from '@/lib/api/types';
import { useMissionSystemCommander, usePrincipalStore } from '@/stores/principalStore';
import { ScheduleHistoryRecord, passTitle } from './ScheduleHistoryRecord';

/** A completed schedule pass from History. A run's label opens its workflow History record. */
export function ScheduleHistoryDialog({ id, onClose, onDeleted, onOpenRun }: {
  id: string; onClose: () => void; onDeleted: () => void; onOpenRun: (historyId: string) => void;
}) {
  const [pass, setPass] = useState<ScheduleHistoryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const isAdmin = usePrincipalStore((s) => s.principal?.isAdministrator ?? false);
  const isCommander = useMissionSystemCommander(pass?.workCenterId);
  const canDelete = isAdmin || (pass?.workCenterId != null && isCommander);

  useEffect(() => {
    let live = true;
    runtimeHistory.passDetail(id).then(
      (p) => { if (live) setPass(p); },
      (err) => { if (live) setError(apiErrorMessage(err, 'Could not load the record')); },
    );
    return () => { live = false; };
  }, [id]);

  const remove = async () => {
    setBusy(true);
    try { await runtimeHistory.removePass(id); toast.success('Deleted'); onDeleted(); onClose(); }
    catch (err) { toast.error(apiErrorMessage(err, 'Delete failed')); setConfirming(false); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{pass ? passTitle(pass) : 'Schedule pass'}</DialogTitle>
          <DialogDescription>Every workflow this schedule started in one pass, with its starting values.</DialogDescription>
        </DialogHeader>
        {!pass && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {pass && (
          <ScheduleHistoryRecord pass={pass} renderLabel={(w) => (w.historyId
            ? (
              <button type="button" className="underline-offset-2 hover:underline" aria-label={`Open ${w.runtimeLabel}`}
                onClick={() => onOpenRun(w.historyId!)}>{w.runtimeLabel}</button>
            )
            : w.runtimeLabel)} />
        )}
        <DialogFooter>
          {pass && canDelete && !confirming && (
            <Button type="button" variant="destructiveOutline" onClick={() => setConfirming(true)}>Delete</Button>
          )}
          {confirming && (
            <>
              <span className="self-center text-sm">Delete this pass from History? Its workflows&apos; own records stay.</span>
              <Button type="button" variant="outline" onClick={() => setConfirming(false)}>Keep it</Button>
              <Button type="button" variant="destructiveOutline" disabled={busy} onClick={remove}>Delete pass</Button>
            </>
          )}
          <Button type="button" variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
