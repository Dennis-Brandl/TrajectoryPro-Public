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
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { schedules } from '@/lib/api/schedules';
import { usePolledView } from '@/lib/hooks/usePolledView';
import type { MasterScheduleView } from '@/lib/api/types';
import { defaultOnError, type OnError } from './schedule-format';

/** A callback, or 'disabled' for a button shown but not yet usable. Absent means no button. */
export type MasterAction = ((master: MasterScheduleView) => void) | 'disabled';

const SOURCE_LABEL: Record<MasterScheduleView['source'], string> = { commander: 'Commander', api: 'API' };

/** Master Schedules of one work center. Run Once, Enable Recurrence and Edit are supplied by the caller
 *  (the editor and the dialogs live elsewhere); an absent prop hides its button. Delete works here. */
export function MasterScheduleList({ workCenterId, canControl, onError = defaultOnError, onEdit, onEnable, onRunOnce, onExportPdf, variant = 'table', canDelete = true }: {
  workCenterId: string;
  canControl: boolean;
  onError?: OnError;
  onEdit?: MasterAction;
  onEnable?: MasterAction;
  onRunOnce?: MasterAction;
  /** Export PDF, shown to everyone who can read the list, since it changes nothing. */
  onExportPdf?: MasterAction;
  /** 'cards' stacks each Master Schedule in a card, for phone widths. */
  variant?: 'table' | 'cards';
  /** False hides Delete (XO has no way to change a Master Schedule). */
  canDelete?: boolean;
}) {
  const { view, loading, refresh } = usePolledView(
    `master-schedules:${workCenterId}`, () => schedules.listMasters(workCenterId), 'Loading Master Schedules failed', 5000,
  );
  const [deleting, setDeleting] = useState<MasterScheduleView | null>(null);
  const [busy, setBusy] = useState(false);

  if (!view) return <p className="text-sm text-muted-foreground">{loading ? 'Loading…' : 'Master Schedules unavailable'}</p>;
  if (view.length === 0) return <p className="text-sm text-muted-foreground">No Master Schedules.</p>;

  const action = (a: MasterAction | undefined, label: string, m: MasterScheduleView, unavailable?: string) => {
    if (!a) return null;
    return (
      <Button type="button" variant="outline" size="sm" aria-label={`${label} ${m.name}`}
        disabled={a === 'disabled' || unavailable !== undefined} title={unavailable ?? (a === 'disabled' ? 'Not available yet' : undefined)}
        onClick={a === 'disabled' || unavailable !== undefined ? undefined : () => a(m)}>{label}</Button>
    );
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try { await schedules.deleteMaster(deleting.id); setDeleting(null); refresh(); }
    catch (err) { onError(err, 'Delete failed'); }
    finally { setBusy(false); }
  };

  const actions = (m: MasterScheduleView) => (canControl || onExportPdf) && (
    <div className="flex flex-wrap gap-2">
      {canControl && action(onRunOnce, 'Run Once', m)}
      {canControl && action(onEnable, 'Enable Recurrence', m, m.recurrence.type === 'manual' ? 'A Manual schedule has no recurrence. Use Run Once.' : undefined)}
      {canControl && action(onEdit, 'Edit', m)}
      {action(onExportPdf, 'Export PDF', m)}
      {canControl && canDelete && (
        <Button type="button" variant="destructiveOutline" size="sm" aria-label={`Delete ${m.name}`}
          onClick={() => setDeleting(m)}>Delete</Button>
      )}
    </div>
  );

  return (
    <>
      {variant === 'cards' ? (
        <ul className="space-y-2">
          {view.map((m) => (
            <li key={m.id} className="space-y-2 rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 break-words font-medium">{m.name}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{SOURCE_LABEL[m.source]}</span>
              </div>
              <div className="text-muted-foreground">Version {m.revision} · {m.recurrenceText}</div>
              {actions(m)}
            </li>
          ))}
        </ul>
      ) : (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Version</TableHead>
            <TableHead>Recurrence</TableHead>
            <TableHead>Source</TableHead>
            <TableHead><span className="sr-only">Actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {view.map((m) => (
            <TableRow key={m.id}>
              <TableCell>{m.name}</TableCell>
              <TableCell className="tabular-nums">{m.revision}</TableCell>
              <TableCell>{m.recurrenceText}</TableCell>
              <TableCell>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{SOURCE_LABEL[m.source]}</span>
              </TableCell>
              <TableCell>{actions(m)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      )}
      {deleting && (
        <Dialog open onOpenChange={(o) => { if (!o) setDeleting(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete &quot;{deleting.name}&quot;?</DialogTitle>
              <DialogDescription>
                This removes the Master Schedule. Runtime Schedules already enabled from it are not affected.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
              <Button type="button" variant="destructiveOutline" disabled={busy} onClick={confirmDelete}>Delete Master Schedule</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
