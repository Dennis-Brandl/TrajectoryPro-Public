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
import type { RuntimeWorkflowMonitorSummary } from '@/lib/api/types';
import { RuntimeStatusBadge } from '@/components/runtime/RuntimeStatusBadge';
import { cn } from '@/lib/utils';
import { isWaitingForOperator, needsAttention } from '~/lib/attention';

export function elapsedSince(startedAt: string | null, nowMs: number): string {
  if (!startedAt) return 'Not started';
  const t = Date.parse(startedAt);
  if (Number.isNaN(t)) return 'Not started';
  const mins = Math.max(0, Math.floor((nowMs - t) / 60000));
  if (mins < 1) return 'just started';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} h ${mins % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

export function RuntimeRow({ runtime: r, selected, onSelect }: {
  runtime: RuntimeWorkflowMonitorSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  const stepNames = r.activeSteps.map((s) => s.stepName ?? s.stepType).join(', ');
  const claimant = r.activeSteps.find((s) => s.claimant?.name)?.claimant?.name ?? null;
  const waiting = !claimant && r.activeSteps.some((s) => isWaitingForOperator(s));
  const attention = needsAttention(r);
  return (
    <div
      role="option"
      tabIndex={-1}
      aria-selected={selected}
      data-runtime-id={r.id}
      onClick={onSelect}
      className={cn(
        'min-h-11 cursor-pointer rounded-[10px] border px-3 py-2.5 text-sm',
        attention ? 'border-status-warn bg-status-warn-bg/40' : 'border-border bg-card',
        selected && 'border-selection bg-selection/10',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate font-semibold">
          {r.masterName} <span className="font-normal text-muted-foreground">v{r.masterVersion}</span>
        </span>
        <RuntimeStatusBadge status={r.status} />
      </div>
      {stepNames && <div className="mt-0.5 truncate">{stepNames}</div>}
      {claimant && <div className="mt-0.5 truncate">{claimant}</div>}
      {waiting && <div className="mt-0.5 text-selection">Waiting for operator</div>}
      <div className="mt-1 text-xs text-muted-foreground">
        {[r.runtimeLabel, r.scheduleLabel, elapsedSince(r.startedAt, Date.now()), r.createdByName].filter(Boolean).join(' · ')}
      </div>
    </div>
  );
}
