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
import { schedules } from '@/lib/api/schedules';
import type { RuntimeScheduleView } from '@/lib/api/types';
import { defaultOnError, type OnError } from './schedule-format';

/** Takes an ended Runtime Schedule off the list, after a confirmation. Renders nothing for a live
 *  one, or for someone who cannot control it. */
export function RemoveRuntimeSchedule({ schedule, canControl, onChanged, onError = defaultOnError }: {
  schedule: RuntimeScheduleView;
  canControl: boolean;
  onChanged: () => void;
  onError?: OnError;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!canControl || schedule.status === 'active' || schedule.status === 'paused') return null;

  const remove = async () => {
    setBusy(true);
    try { await schedules.remove(schedule.id); onChanged(); }
    catch (err) { onError(err, 'Remove failed'); }
    finally { setBusy(false); setConfirming(false); }
  };

  return (
    <>
      <Button type="button" variant="outline" size="sm" aria-label={`Remove ${schedule.label}`} onClick={() => setConfirming(true)}>Remove</Button>
      {confirming && (
        <Dialog open onOpenChange={(o) => { if (!o) setConfirming(false); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove {schedule.label} &quot;{schedule.name}&quot; from the list?</DialogTitle>
              <DialogDescription>
                It will no longer be listed here. The History records of its runs stay.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setConfirming(false)}>Keep it</Button>
              <Button type="button" disabled={busy} onClick={remove}>Remove from list</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
