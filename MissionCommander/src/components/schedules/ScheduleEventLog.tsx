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
import { usePolledView } from '@/lib/hooks/usePolledView';
import { eventText } from './event-text';
import { formatInZone } from './schedule-format';

const PAGE_SIZE = 10;

/** A Runtime Schedule's event log, newest first, in plain words. Times use its frozen zone. */
export function ScheduleEventLog({ runtimeId, timeZone }: { runtimeId: string; timeZone: string }) {
  const [offset, setOffset] = useState(0);
  const { view } = usePolledView(
    `schedule-events:${runtimeId}:${offset}`, () => schedules.events(runtimeId, { limit: PAGE_SIZE, offset }),
    'Loading the event log failed', 5000,
  );
  if (!view) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (view.total === 0) return <p className="text-sm text-muted-foreground">No events yet.</p>;
  return (
    <div className="space-y-2">
      <ul className="divide-y rounded-md border">
        {view.rows.map((e) => (
          <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 px-3 py-1.5 text-sm">
            <span className="text-muted-foreground tabular-nums">{formatInZone(e.at, timeZone)}</span>
            <span>{eventText(e, timeZone)}</span>
          </li>
        ))}
      </ul>
      {view.total > PAGE_SIZE && (
        <div className="flex items-center gap-2 text-sm">
          <Button type="button" variant="outline" size="sm" disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Newer events</Button>
          <Button type="button" variant="outline" size="sm" disabled={offset + PAGE_SIZE >= view.total}
            onClick={() => setOffset(offset + PAGE_SIZE)}>Older events</Button>
          <span className="text-muted-foreground">{offset + 1}–{Math.min(offset + PAGE_SIZE, view.total)} of {view.total}</span>
        </div>
      )}
    </div>
  );
}
