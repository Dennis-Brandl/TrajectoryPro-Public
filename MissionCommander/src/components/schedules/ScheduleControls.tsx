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
import { schedules } from '@/lib/api/schedules';
import { ApiError } from '@/lib/api/client';
import type { ResumeChoice, ResumePreview, RuntimeScheduleView } from '@/lib/api/types';
import { CancelDialog } from './CancelDialog';
import { ResumeDialog } from './ResumeDialog';
import { defaultOnError, type OnError } from './schedule-format';

/** Pause / Resume / Cancel for one Runtime Schedule, with their dialogs. Renders nothing when the
 *  person cannot control, or the schedule has ended. Shared by the list rows and the detail. */
export function ScheduleControls({ schedule, canControl, onChanged, onError = defaultOnError }: {
  schedule: RuntimeScheduleView;
  canControl: boolean;
  onChanged: () => void;
  onError?: OnError;
}) {
  const [resume, setResume] = useState<{ preview: ResumePreview; outage: boolean; notice: string | null } | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const live = schedule.status === 'active' || schedule.status === 'paused';
  if (!canControl || !live) return null;

  const run = async (fallback: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); onChanged(); return true; }
    catch (err) { onError(err, fallback); return false; }
    finally { setBusy(false); }
  };

  // Nothing missed and nothing held: no choice to make, so Resume goes straight through.
  const startResume = (outage: boolean) => run('Resume failed', async () => {
    const preview = await schedules.resumePreview(schedule.id);
    if (preview.missedCount === 0 && preview.held.length === 0) { await schedules.resume(schedule.id, {}); return; }
    setResume({ preview, outage, notice: null });
  });

  // The count the person chose from can go stale while the dialog sits open. The server refuses
  // then; show its message over a fresh preview so the choice is made again on the real count.
  const confirmResume = async (choice: ResumeChoice) => {
    setBusy(true);
    try {
      await schedules.resume(schedule.id, choice);
      onChanged();
      setResume(null);
    } catch (err) {
      if (err instanceof ApiError && err.message.startsWith('The number of missed starts changed')) {
        try {
          const fresh = await schedules.resumePreview(schedule.id);
          setResume((r) => (r ? { ...r, preview: fresh, notice: err.message } : r));
        } catch (err2) { onError(err2, 'Resume failed'); }
      } else onError(err, 'Resume failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {schedule.status === 'active' && (
        <Button type="button" variant="outline" size="sm" disabled={busy} aria-label={`Pause ${schedule.label}`}
          onClick={() => run('Pause failed', () => schedules.pause(schedule.id))}>Pause</Button>
      )}
      {schedule.status === 'paused' && (
        <Button type="button" variant="outline" size="sm" disabled={busy} aria-label={`Resume ${schedule.label}`}
          onClick={() => startResume(false)}>Resume</Button>
      )}
      {schedule.status === 'active' && schedule.needsAttention.missedWindow && (
        <Button type="button" variant="outline" size="sm" disabled={busy} aria-label={`Decide missed starts for ${schedule.label}`}
          onClick={() => startResume(true)}>Decide missed starts</Button>
      )}
      <Button type="button" variant="destructiveOutline" size="sm" aria-label={`Cancel ${schedule.label}`}
        onClick={() => setCancelOpen(true)}>Cancel</Button>
      {resume && (
        <ResumeDialog schedule={schedule} preview={resume.preview} outage={resume.outage} notice={resume.notice}
          onConfirm={confirmResume} onClose={() => setResume(null)} />
      )}
      {cancelOpen && (
        <CancelDialog label={schedule.label} name={schedule.name} onClose={() => setCancelOpen(false)}
          onConfirm={async (reason) => { if (await run('Cancel failed', () => schedules.cancel(schedule.id, reason))) setCancelOpen(false); }} />
      )}
    </div>
  );
}
