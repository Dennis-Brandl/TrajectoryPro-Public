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
import { Input } from '@/components/ui/input';
import { schedules } from '@/lib/api/schedules';
import type { DefinitionProblem, MasterScheduleView, RunOncePreview, RuntimeScheduleView } from '@/lib/api/types';
import { describePath, problemsOf } from './master-schedule-model';
import { ScheduleClockNote } from './ScheduleClockNote';
import { defaultOnError, formatInZone, type OnError } from './schedule-format';

/** The toast after Run Once: `at` is the time asked for, absent for "now". */
export function runOnceMessage(runtime: RuntimeScheduleView, at?: string): string {
  return at && runtime.nextFireAt
    ? `${runtime.label} will start ${formatInZone(runtime.nextFireAt, runtime.timeZone)}`
    : `Starting as ${runtime.label}`;
}

/** Run Once confirmation: one more click so a stray one cannot start, say, a fire response. Names what
 *  will start, now or at a chosen time. A refusal lists every problem and leaves the dialog open. */
export function RunOnceDialog({ master, canSetZone = false, onClose, onStarted, onError = defaultOnError }: {
  master: MasterScheduleView;
  /** True where a person may set the work center's zone from here. */
  canSetZone?: boolean;
  onClose: () => void;
  onStarted: (result: { runtime: RuntimeScheduleView; warnings: string[] }, at?: string) => void;
  onError?: OnError;
}) {
  const [preview, setPreview] = useState<RunOncePreview | null>(null);
  const [refused, setRefused] = useState<DefinitionProblem[]>([]);
  const [later, setLater] = useState(false);
  const [at, setAt] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    schedules.previewRunOnce(master.id).then(
      (p) => { if (live) setPreview(p); },
      (err) => { if (live) onError(err, 'Checking the schedule failed'); },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per Master Schedule
  }, [master.id]);

  const problems = [...(preview?.problems ?? []), ...refused.filter((r) => !preview?.problems.some((p) => p.path === r.path && p.message === r.message))];
  const blocked = preview === null || preview.problems.length > 0 || (later && at === '');

  const start = async () => {
    setBusy(true);
    setRefused([]);
    const chosen = later ? at : undefined;
    try { onStarted(await schedules.runOnce(master.id, chosen), chosen); }
    catch (err) {
      const found = problemsOf(err);
      if (found.length > 0) setRefused(found);
      else onError(err, 'Run Once failed');
    } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Run &quot;{master.name}&quot; once?</DialogTitle>
          <DialogDescription>This starts a separate run of the schedule, alongside anything already running.</DialogDescription>
        </DialogHeader>

        <div className="space-y-1 text-sm">
          <div className="font-medium">Workflows that start</div>
          <ul aria-label="Workflows that start" className="list-disc pl-5">
            {master.items.map((it, i) => (
              <li key={i}>
                {it.workflow.name}
                {(it.chain?.length ?? 0) > 0 && <span className="text-muted-foreground"> and its chained workflows</span>}
              </li>
            ))}
          </ul>
        </div>

        <div role="radiogroup" aria-label="When to start" className="space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="run-once-when" checked={!later} onChange={() => setLater(false)} />
            Start now
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="run-once-when" checked={later} onChange={() => setLater(true)} />
            At a date and time
          </label>
          {later && (
            <div className="space-y-2 pl-6">
              <Input type="datetime-local" aria-label="Start date and time" className="w-56" value={at} onChange={(e) => setAt(e.target.value)} />
              <ScheduleClockNote workCenterId={master.workCenterId} canSetZone={canSetZone} />
            </div>
          )}
        </div>

        {preview && preview.warnings.length > 0 && (
          <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
            <p className="font-medium">Warnings</p>
            <ul className="list-disc pl-5">{preview.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </div>
        )}
        {problems.length > 0 && (
          <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
            <p className="font-medium">This schedule cannot start:</p>
            <ul className="list-disc pl-5">{problems.map((p, i) => <li key={i}>{p.path === 'at' ? p.message : `${describePath(p.path)}: ${p.message}`}</li>)}</ul>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={busy || blocked} onClick={start}>{later ? 'Schedule run' : 'Start now'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
