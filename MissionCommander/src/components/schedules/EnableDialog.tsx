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
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { schedules } from '@/lib/api/schedules';
import type { DefinitionProblem, EnablePreview, MasterScheduleView, RuntimeScheduleView } from '@/lib/api/types';
import { defaultOnError, formatInZone, type OnError } from './schedule-format';
import { describePath, problemsOf } from './master-schedule-model';

const SHOWN = 3;

/** Enable confirmation (spec 2026-11-08 §5.3, §10): the first fire times and any warnings, from the
 *  same preview the server runs, then Enable. A refusal lists every problem and leaves the dialog open. */
export function EnableDialog({ master, onClose, onEnabled, onError = defaultOnError }: {
  master: MasterScheduleView;
  onClose: () => void;
  onEnabled: (result: { runtime: RuntimeScheduleView; warnings: string[] }) => void;
  onError?: OnError;
}) {
  const [preview, setPreview] = useState<EnablePreview | null>(null);
  const [refused, setRefused] = useState<DefinitionProblem[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    schedules.previewEnable(master.id).then(
      (p) => { if (live) setPreview(p); },
      (err) => { if (live) onError(err, 'Previewing Enable failed'); },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- preview once per Master Schedule
  }, [master.id]);

  const problems = [...(preview?.problems ?? []), ...refused.filter((r) => !preview?.problems.some((p) => p.path === r.path && p.message === r.message))];

  const enable = async () => {
    setBusy(true);
    setRefused([]);
    try { onEnabled(await schedules.enable(master.id)); }
    catch (err) {
      const found = problemsOf(err);
      if (found.length > 0) setRefused(found);
      else onError(err, 'Enable failed');
    } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Enable recurrence for &quot;{master.name}&quot;?</DialogTitle>
          <DialogDescription>
            This turns the Master Schedule into a Runtime Schedule that starts its workflows at the times below.
          </DialogDescription>
        </DialogHeader>

        {preview === null && <p className="text-sm text-muted-foreground">Checking…</p>}
        {preview && preview.nextFireTimes.length > 0 && (
          <div className="space-y-1 text-sm">
            <div className="font-medium">First fire times</div>
            <ul aria-label="First fire times" className="space-y-0.5">
              {preview.nextFireTimes.slice(0, SHOWN).map((t) => <li key={t}>{formatInZone(t, preview.timeZone ?? 'UTC')}</li>)}
            </ul>
            {preview.timeZone && <p className="text-xs text-muted-foreground">In the work center&apos;s time zone ({preview.timeZone}).</p>}
          </div>
        )}
        {preview && preview.warnings.length > 0 && (
          <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
            <p className="font-medium">Warnings</p>
            <ul className="list-disc pl-5">{preview.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </div>
        )}
        {problems.length > 0 && (
          <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
            <p className="font-medium">This Master Schedule cannot be enabled yet:</p>
            <ul className="list-disc pl-5">{problems.map((p, i) => <li key={i}>{describePath(p.path)}: {p.message}</li>)}</ul>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={busy || preview === null || (preview.problems.length > 0)} onClick={enable}>Enable Recurrence</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
