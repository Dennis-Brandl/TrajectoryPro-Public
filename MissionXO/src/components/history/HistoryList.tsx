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
import type { RuntimeHistorySummary } from '@/lib/api/types';
import { formatDuration } from '@/components/history/format-duration';
import { cn } from '@/lib/utils';
import { dayLabel } from './history-filters';

const TONE: Record<string, string> = { completed: 'text-status-ok-fg', errored: 'text-destructive' };
const RESULT_TEXT: Record<string, string> = { errored: 'Failed' };

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function HistoryList({ rows, selectedId, onSelect, now }: {
  rows: RuntimeHistorySummary[]; selectedId?: string; onSelect: (id: string) => void; now: Date;
}) {
  const groups: Array<{ label: string; items: RuntimeHistorySummary[] }> = [];
  for (const r of rows) {
    const label = dayLabel(r.finishedAt, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(r); else groups.push({ label, items: [r] });
  }
  return (
    <div role="listbox" aria-label="History">
      {groups.map((g) => (
        <div key={g.label} role="group" aria-label={g.label}>
          <div className="px-1 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g.label}</div>
          <div className="flex flex-col gap-2">
            {g.items.map((r) => (
              <div
                key={r.id} role="option" tabIndex={0} aria-selected={r.id === selectedId} data-history-id={r.id}
                onClick={() => onSelect(r.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(r.id); } }}
                className={cn(
                  'min-h-11 cursor-pointer rounded-[10px] border border-border bg-card px-3 py-2.5 text-sm',
                  r.id === selectedId && 'border-selection bg-selection/10',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 truncate font-semibold">
                    {r.masterName} <span className="font-normal text-muted-foreground">v{r.masterVersion}</span>
                  </span>
                  <span className={cn('shrink-0 text-[11px] font-bold uppercase tracking-wide', TONE[r.finalState] ?? 'text-muted-foreground')}>
                    {RESULT_TEXT[r.finalState] ?? r.finalState}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {r.runtimeLabel} · finished {hhmm(r.finishedAt)} · {formatDuration(r.startedAt, r.finishedAt)}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
