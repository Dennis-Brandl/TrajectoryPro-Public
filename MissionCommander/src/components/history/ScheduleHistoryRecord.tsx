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

import type { ReactNode } from 'react';
import type { ScheduleHistoryDetail, ScheduleHistorySummary, ScheduleHistoryWorkflow } from '@/lib/api/types';
import { formatInZone } from '@/components/schedules/schedule-format';
import { formatDuration } from './format-duration';

// One completed schedule pass, as History shows it in Commander's dialog and XO's detail page:
// what was scheduled and when, then each workflow it started with its label, times, how it
// ended and its starting values. Chained workflows sit under the run that started them.

const ENDING: Record<string, string> = { completed: 'Completed', aborted: 'Aborted', stopped: 'Stopped', errored: 'Errored' };
const NOT_RUN: Record<string, string> = {
  not_triggered: 'Not triggered', skipped_disabled: 'Skipped (disabled)', cancelled: 'Cancelled',
  skipped_on_resume: 'Skipped on Resume', failed_to_start: 'Failed to start', lost: 'Lost',
};

export function workflowResult(w: Pick<ScheduleHistoryWorkflow, 'status' | 'finalState'>): string {
  if (w.status === 'finished') return ENDING[w.finalState ?? ''] ?? w.finalState ?? 'Finished';
  return NOT_RUN[w.status] ?? w.status;
}

/** "3 completed", "2 completed, 1 with problems, 2 not started". */
export function passOutcome(c: ScheduleHistorySummary['counts']): string {
  const parts = [`${c.completed} completed`];
  if (c.problems > 0) parts.push(`${c.problems} with problems`);
  if (c.notStarted > 0) parts.push(`${c.notStarted} not started`);
  return parts.join(', ');
}

/** "RS-3 pass 2", or "RS-7 Run Once". */
export const passTitle = (p: Pick<ScheduleHistorySummary, 'scheduleLabel' | 'occurrenceNumber' | 'runOnce'>) =>
  p.runOnce ? `${p.scheduleLabel} Run Once` : `${p.scheduleLabel} pass ${p.occurrenceNumber}`;

function depthOf(w: ScheduleHistoryWorkflow, byRun: Map<string, ScheduleHistoryWorkflow>): number {
  let depth = 0;
  for (let p = w.parentRunId; p && depth < 16; p = byRun.get(p)?.parentRunId ?? null) depth++;
  return depth;
}

export function ScheduleHistoryRecord({ pass, renderLabel }: {
  pass: ScheduleHistoryDetail;
  /** The run's label, made a link where its workflow History record still exists. */
  renderLabel: (w: ScheduleHistoryDetail['workflows'][number]) => ReactNode;
}) {
  const zone = pass.timeZone;
  const at = (iso: string | null) => (iso ? formatInZone(iso, zone) : '—');
  const byRun = new Map(pass.workflows.map((w) => [w.runId, w]));
  return (
    <div className="space-y-4 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">Schedule</dt><dd className="min-w-0 break-words">{pass.scheduleName}</dd>
        <dt className="text-muted-foreground">Work center</dt><dd className="min-w-0 break-words">{pass.workCenterName}</dd>
        <dt className="text-muted-foreground">Scheduled</dt><dd>{at(pass.scheduledAt)}{pass.origin !== 'on_time' && <span className="text-muted-foreground"> ({pass.origin === 'late' ? 'started late' : 'started on Resume'})</span>}</dd>
        <dt className="text-muted-foreground">Ran</dt><dd>{at(pass.startedAt)} to {at(pass.finishedAt)} ({formatDuration(pass.startedAt, pass.finishedAt)})</dd>
        <dt className="text-muted-foreground">Result</dt><dd>{passOutcome(pass.counts)}</dd>
      </dl>
      <p className="text-xs text-muted-foreground">Times are in {zone}.</p>
      <ul aria-label="Workflows in this pass" className="space-y-2">
        {pass.workflows.map((w) => {
          const values = Object.entries(w.startingValues ?? {});
          return (
            <li key={w.runId} aria-label={`Workflow ${w.name}`} className="rounded-md border border-border p-3"
              style={{ marginLeft: `${Math.min(depthOf(w, byRun), 6) * 1.25}rem` }}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="min-w-0 break-words font-medium">
                  {w.parentRunId && <span className="text-muted-foreground" aria-hidden>↳ </span>}
                  {w.name} <span className="font-normal text-muted-foreground">v{w.version}</span>
                </span>
                <span className="shrink-0 font-medium">{workflowResult(w)}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 text-muted-foreground">
                {w.runtimeLabel && <span className="tabular-nums text-foreground">{renderLabel(w)}</span>}
                {w.startedAt && <span>Started {at(w.startedAt)}</span>}
                {w.finishedAt && w.status === 'finished' && <span>Finished {at(w.finishedAt)}</span>}
              </div>
              {w.detail && <p className="mt-1 break-words text-destructive">{w.detail}</p>}
              {values.length > 0 && (
                <dl aria-label={`Starting values of ${w.name}`} className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                  {values.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted-foreground">{k}</dt><dd className="min-w-0 break-words font-mono text-xs leading-5">{v === '' ? '—' : v}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
