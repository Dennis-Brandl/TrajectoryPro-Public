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
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { schedules } from '@/lib/api/schedules';
import { usePolledView } from '@/lib/hooks/usePolledView';
import type { OccurrencePage, OccurrenceRun, RuntimeScheduleItemView } from '@/lib/api/types';
import { defaultOnError, formatInZone, type OnError } from './schedule-format';

const PAGE_SIZE = 10;
type RunStatus = OccurrencePage['rows'][number]['runs'][number]['status'];

const RUN_STATUS: Record<RunStatus, string> = {
  started: 'Started', finished: 'Finished', not_triggered: 'Not triggered', skipped_disabled: 'Skipped (disabled)',
  held: 'Waiting (held)', start_requested: 'Start requested', cancelled: 'Cancelled',
  skipped_on_resume: 'Skipped on Resume', failed_to_start: 'Failed to start', lost: 'Lost',
};
const ORIGIN: Record<string, string> = { on_time: 'On time', late: 'Late', resume: 'Catch-up' };

function itemNames(items: RuntimeScheduleItemView[], into = new Map<string, string>()): Map<string, string> {
  for (const it of items) { into.set(it.id, it.masterName); itemNames(it.children, into); }
  return into;
}

/** Occurrences, newest first, with each item's outcome. Failed and lost items can be dismissed one
 *  by one or all together; there is no Retry (spec §7.2). Polls every 2 s. */
export function OccurrenceList({ runtimeId, items, timeZone, canControl, onError = defaultOnError, onChanged, renderRunLink }: {
  runtimeId: string;
  items: RuntimeScheduleItemView[];
  timeZone: string;
  canControl: boolean;
  onError?: OnError;
  onChanged?: () => void;
  /** Draws the run's label as a link to its record. Without it the label is plain text. */
  renderRunLink?: (run: OccurrenceRun) => ReactNode;
}) {
  const [offset, setOffset] = useState(0);
  const { view, refresh } = usePolledView(
    `occurrences:${runtimeId}:${offset}`, () => schedules.occurrences(runtimeId, { limit: PAGE_SIZE, offset }),
    'Loading occurrences failed', 2000,
  );
  if (!view) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (view.total === 0) return <p className="text-sm text-muted-foreground">No occurrences yet.</p>;

  const names = itemNames(items);
  const dismissable = (r: { status: RunStatus; acknowledgedAt: string | null }) =>
    (r.status === 'failed_to_start' || r.status === 'lost') && r.acknowledgedAt === null;
  const anyDismissable = view.rows.some((o) => o.runs.some(dismissable));

  const dismiss = async (ids: string[] | 'all') => {
    try { await schedules.acknowledge(runtimeId, ids); refresh(); onChanged?.(); }
    catch (err) { onError(err, 'Dismiss failed'); }
  };

  return (
    <div className="space-y-2">
      {canControl && anyDismissable && (
        <Button type="button" variant="outline" size="sm" onClick={() => dismiss('all')}>Dismiss all</Button>
      )}
      <ul className="divide-y rounded-md border">
        {view.rows.map((o) => (
          <li key={o.id} className="space-y-1 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">Occurrence {o.number}</span>
              <span className="text-muted-foreground">{formatInZone(o.scheduledAt, timeZone)}</span>
              <span className="text-xs text-muted-foreground">{ORIGIN[o.origin] ?? o.origin}</span>
            </div>
            {o.runs.map((r) => {
              const name = r.itemName ?? names.get(r.itemId) ?? '(removed item)';
              return (
                <div key={r.id} className="flex flex-wrap items-center gap-2 pl-4">
                  <span>{name}</span>
                  {r.runtimeLabel && <span className="tabular-nums">{renderRunLink ? renderRunLink(r) : r.runtimeLabel}</span>}
                  <span className={dismissable(r) ? 'text-status-warn-fg' : 'text-muted-foreground'}>{RUN_STATUS[r.status]}</span>
                  {r.finalState && <span className="text-muted-foreground">{r.finalState}</span>}
                  {r.detail && <span className="text-muted-foreground">{r.detail}</span>}
                  {canControl && dismissable(r) && (
                    <Button type="button" variant="outline" size="sm" className="ml-auto"
                      aria-label={`Dismiss ${name} (${RUN_STATUS[r.status]})`} onClick={() => dismiss([r.id])}>Dismiss</Button>
                  )}
                </div>
              );
            })}
          </li>
        ))}
      </ul>
      {view.total > PAGE_SIZE && (
        <div className="flex items-center gap-2 text-sm">
          <Button type="button" variant="outline" size="sm" disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Newer</Button>
          <Button type="button" variant="outline" size="sm" disabled={offset + PAGE_SIZE >= view.total}
            onClick={() => setOffset(offset + PAGE_SIZE)}>Older</Button>
          <span className="text-muted-foreground">{offset + 1}–{Math.min(offset + PAGE_SIZE, view.total)} of {view.total}</span>
        </div>
      )}
    </div>
  );
}
