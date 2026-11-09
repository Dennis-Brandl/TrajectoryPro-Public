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
import { useEffect } from 'react';
import type { RuntimeScheduleView } from '@/lib/api/types';
import { schedules } from '@/lib/api/schedules';
import { usePolledView } from '@/lib/hooks/usePolledView';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { NeedsAttentionPill } from './NeedsAttentionPill';
import { RemoveRuntimeSchedule } from './RemoveRuntimeSchedule';
import { ScheduleControls } from './ScheduleControls';
import { STATUS_LABEL, formatInZone, type OnError } from './schedule-format';

const RunOnceTag = () => <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">Run Once</span>;

/** Runtime Schedules of one work center (spec 2026-11-08 §10). Polls every 5 s. Times are in each
 *  Runtime's frozen zone; the zone is named once in the header. */
export function RuntimeScheduleList({ workCenterId, canControl, onError, onOpen, variant = 'table', onLoaded }: {
  workCenterId: string;
  canControl: boolean;
  onError?: OnError;
  onOpen: (runtimeId: string) => void;
  /** 'cards' stacks each schedule in a card, for phone widths. */
  variant?: 'table' | 'cards';
  /** Called with each fresh list, so a caller can count what needs attention without a second poll. */
  onLoaded?: (rows: RuntimeScheduleView[]) => void;
}) {
  const { view, loading, refresh } = usePolledView(
    `runtime-schedules:${workCenterId}`, () => schedules.listRuntimes(workCenterId), 'Loading Runtime Schedules failed', 5000,
  );
  useEffect(() => { if (view) onLoaded?.(view); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps -- once per fresh list
  if (!view) return <p className="text-sm text-muted-foreground">{loading ? 'Loading…' : 'Runtime Schedules unavailable'}</p>;
  if (view.length === 0) return <p className="text-sm text-muted-foreground">No Runtime Schedules. Use Run Once or Enable Recurrence on a Master Schedule to start one.</p>;
  const zone = view[0].timeZone;
  const nextStart = (r: RuntimeScheduleView) => r.nextFireAt && (r.status === 'active' || r.status === 'paused')
    ? <>{formatInZone(r.nextFireAt, r.timeZone)}{r.timeZone !== zone && <span className="text-muted-foreground"> {r.timeZone}</span>}</>
    : '—';
  if (variant === 'cards') {
    return (
      <ul className="space-y-2">
        {view.map((r) => (
          <li key={r.id} className="space-y-2 rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="min-h-9 font-medium tabular-nums underline-offset-2 hover:underline" onClick={() => onOpen(r.id)}>{r.label}</button>
              <span className="min-w-0 break-words">{r.name}</span>
              {r.runOnce && <RunOnceTag />}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span>{STATUS_LABEL[r.status]}</span>
              <NeedsAttentionPill schedule={r} />
            </div>
            <div className="text-muted-foreground">Next start ({zone}): <span className="text-foreground">{nextStart(r)}</span></div>
            <ScheduleControls schedule={r} canControl={canControl} onChanged={refresh} onError={onError} />
            <RemoveRuntimeSchedule schedule={r} canControl={canControl} onChanged={refresh} onError={onError} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Schedule</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Next start ({zone})</TableHead>
          <TableHead><span className="sr-only">Controls</span></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {view.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="tabular-nums">
              <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => onOpen(r.id)}>{r.label}</button>
            </TableCell>
            <TableCell>{r.name} {r.runOnce && <RunOnceTag />}</TableCell>
            <TableCell>
              <span className="flex items-center gap-2">
                <span>{STATUS_LABEL[r.status]}</span>
                <NeedsAttentionPill schedule={r} />
              </span>
            </TableCell>
            <TableCell>{nextStart(r)}</TableCell>
            <TableCell>
              <ScheduleControls schedule={r} canControl={canControl} onChanged={refresh} onError={onError} />
              <RemoveRuntimeSchedule schedule={r} canControl={canControl} onChanged={refresh} onError={onError} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
