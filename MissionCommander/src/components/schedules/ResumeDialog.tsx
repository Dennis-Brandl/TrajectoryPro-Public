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
import type { ResumeChoice, ResumePreview, RuntimeScheduleView } from '@/lib/api/types';
import { agoText, formatInZone, formatLongSlot, formatSlot } from './schedule-format';

type Missed = NonNullable<ResumeChoice['missed']>;

/** Spec 2026-11-08 §7.3. Nothing is chosen by default when more than one start was missed.
 *  `outage` is the same dialog opened from Needs attention, without the pause heading. */
export function ResumeDialog({ schedule, preview, outage, notice, onConfirm, onClose }: {
  schedule: Pick<RuntimeScheduleView, 'label' | 'name' | 'timeZone'>;
  preview: ResumePreview;
  outage?: boolean;
  /** Shown above the choices, e.g. why the count was refreshed. */
  notice?: string | null;
  onConfirm: (choice: ResumeChoice) => void | Promise<void>;
  onClose: () => void;
}) {
  const tz = schedule.timeZone;
  const count = preview.missedCount;
  const [missed, setMissed] = useState<Missed | null>(count === 1 ? 'all' : null);
  const [ticked, setTicked] = useState<Record<string, boolean>>(() => Object.fromEntries(preview.held.map((h) => [h.id, true])));
  const [busy, setBusy] = useState(false);

  // A refreshed preview with a different count voids a choice made on the old one.
  useEffect(() => { setMissed(count === 1 ? 'all' : null); }, [count]);

  const needsChoice = count > 0 && missed === null;
  const submit = async () => {
    // Always the count shown, so the server refuses if it has changed since.
    const choice: ResumeChoice = { expectedMissedCount: count };
    if (count > 0 && missed) choice.missed = missed;
    if (preview.held.length > 0) {
      choice.heldChains = {
        start: preview.held.filter((h) => ticked[h.id]).map((h) => h.id),
        skip: preview.held.filter((h) => !ticked[h.id]).map((h) => h.id),
      };
    }
    setBusy(true);
    try { await onConfirm(choice); } finally { setBusy(false); }
  };

  const range = preview.missedFirst && preview.missedLast
    ? ` (${formatSlot(preview.missedFirst, tz)} … ${formatSlot(preview.missedLast, tz)})` : '';
  const radio = (value: Missed, text: string, disabled = false) => (
    <label key={value} className="flex items-center gap-2 text-sm">
      <input type="radio" name="missed" checked={missed === value} disabled={disabled} onChange={() => setMissed(value)} />
      {text}
    </label>
  );

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{outage ? 'Missed starts for' : 'Resume'} {schedule.label} &quot;{schedule.name}&quot;</DialogTitle>
          <DialogDescription>
            {!outage && preview.pausedAt
              ? `Paused ${formatLongSlot(preview.pausedAt, tz)}${preview.pausedBy ? ` by ${preview.pausedBy}` : ''}, ${agoText(preview.pausedAt)} ago`
              : 'Choose what happens to the starts that were missed.'}
          </DialogDescription>
        </DialogHeader>

        {notice && <p role="alert" className="text-sm text-status-warn-fg">{notice}</p>}

        {count > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">
              Missed scheduled starts: {preview.missedMore ? 'over 500' : count}{range}
            </p>
            {count === 1 ? (
              <>{radio('all', 'Start it')}{radio('skip', 'Skip it')}</>
            ) : (
              <>
                {radio('all', preview.startAllAllowed ? `Start all ${count}` : 'Start all', !preview.startAllAllowed)}
                {radio('latest', `Start only the latest${preview.missedLast ? ` (${formatSlot(preview.missedLast, tz)})` : ''}`)}
                {radio('skip', 'Skip them all')}
              </>
            )}
            {!preview.startAllAllowed && (
              <p className="text-sm text-muted-foreground">
                Start all is unavailable because more than 500 starts were missed.
              </p>
            )}
          </div>
        )}

        {preview.held.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Chains waiting from runs that ended while paused: {preview.held.length}</p>
            {preview.held.map((h) => (
              <label key={h.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={ticked[h.id] ?? true}
                  onChange={(e) => setTicked((t) => ({ ...t, [h.id]: e.target.checked }))} />
                <span>
                  {h.name}
                  <span className="text-muted-foreground">
                    {' '}(from {h.fromRunLabel ?? 'a run'}{h.fromFinishedAt ? `, ${h.fromFinalState ?? 'ended'} ${formatInZone(h.fromFinishedAt, tz)}` : ''})
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={needsChoice || busy} onClick={submit}>{outage ? 'Apply' : 'Resume'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
