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
import { apiErrorMessage } from '@/lib/api/client';
import { schedules } from '@/lib/api/schedules';
import { workCenters } from '@/lib/api/work-centers';
import type { ScheduleClock } from '@/lib/api/types';
import { formatInZone } from './schedule-format';

const NOW_REFRESH_MS = 30_000;

const browserZone = (): string | null => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; }
};

/** Says which clock schedule times are read on, as a time typed here means nothing without it. When a
 *  work center has no zone of its own and the fallback differs from this person's, a time they type
 *  lands hours away from what they meant, so it warns and, with `canSetZone`, offers to fix it. */
export function ScheduleClockNote({ workCenterId, canSetZone = false, onZoneChanged }: {
  workCenterId: string;
  canSetZone?: boolean;
  onZoneChanged?: () => void;
}) {
  const [clock, setClock] = useState<ScheduleClock | null>(null);
  const [now, setNow] = useState(() => new Date().toISOString());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    schedules.clock(workCenterId).then((c) => { if (live) setClock(c); }, () => { /* the note is a help; the form still works */ });
    return () => { live = false; };
  }, [workCenterId]);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date().toISOString()), NOW_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  if (!clock) return null;
  const mine = browserZone();
  const differs = !clock.workCenterZoneSet && mine !== null && mine !== clock.timeZone;

  const useMine = async () => {
    if (!mine) return;
    setBusy(true);
    setFailure(null);
    try {
      await workCenters.update(workCenterId, { timeZone: mine });
      setClock({ timeZone: mine, workCenterZoneSet: true });
      onZoneChanged?.();
    } catch (err) {
      setFailure(apiErrorMessage(err, 'Setting the time zone failed'));
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-2 text-sm">
      <p className="text-muted-foreground">
        Times are in <span className="font-medium text-foreground">{clock.timeZone}</span>, where it is now <span className="font-medium text-foreground">{formatInZone(now, clock.timeZone)}</span>.
      </p>
      {differs && (
        <div role="alert" className="space-y-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
          <p>This work center has no time zone of its own, so times you enter are read as {clock.timeZone}, not your {mine}.</p>
          {canSetZone && (
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={useMine}>Use {mine} for this work center</Button>
          )}
          {failure && <p className="text-destructive">{failure}</p>}
        </div>
      )}
    </div>
  );
}
