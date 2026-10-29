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
import { Button } from '@/components/ui/button';
import { RuntimeStatusBadge } from './RuntimeStatusBadge';
import { humaniseState } from './diagram/state';
import type { RuntimeWorkflowMonitorSummary } from '@/lib/api/types';

const MAX_STEPS_SHOWN = 2;

/** Lean live card (spec D3): summary + current steps + claimant + error, rendered as plain
 *  static markup AT can read. The whole-card click is an empty absolutely-positioned overlay
 *  button that opens the detail dialog — its aria-label carries the accessible name without
 *  suppressing the content subtree beneath it. A visible "Monitor and Control" button
 *  (2026-08-10 user-testing ticket: nothing signalled the card was clickable) opens the same
 *  dialog; it sits above the overlay via z-index, so both stay independently clickable. */
export function RuntimeCard({ rw, onOpen }: { rw: RuntimeWorkflowMonitorSummary; onOpen: (id: string) => void }) {
  const shown = rw.activeSteps.slice(0, MAX_STEPS_SHOWN);
  const extra = rw.activeSteps.length - shown.length;
  return (
    <div className="relative rounded-md border bg-card p-3 text-sm shadow-sm transition-colors hover:bg-accent/30">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium tabular-nums">{rw.runtimeLabel}</span>
        <RuntimeStatusBadge status={rw.status} />
      </div>
      <div className="mt-1 truncate">
        {rw.masterName} <span className="text-muted-foreground">v{rw.masterVersion}</span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        Created {new Date(rw.createdAt).toLocaleString()}
        {rw.startedAt ? ` · Started ${new Date(rw.startedAt).toLocaleString()}` : ''}
        {rw.createdByName ? ` · ${rw.createdByName}` : ''}
      </div>
      {shown.map((s) => (
        <div key={s.stepOid} className="mt-1 truncate text-xs">
          <span className="font-medium">{s.stepName ?? s.stepOid}</span>
          <span className="text-muted-foreground"> — {s.state === 'WAITING_USER'
            ? (s.claimant ? `Claimed by ${s.claimant.name ?? 'unknown'}` : 'Offered')
            : humaniseState(s.state)}</span>
        </div>
      ))}
      {extra > 0 && <div className="mt-1 text-xs text-muted-foreground">+{extra} more</div>}
      {rw.errorText && <div className="mt-1 truncate text-xs text-destructive" title={rw.errorText}>{rw.errorText}</div>}
      <Button type="button" variant="outline" size="sm" className="relative z-10 mt-2 w-full"
        aria-label={`Monitor and control ${rw.runtimeLabel}`}
        onClick={() => onOpen(rw.id)}>
        Monitor and Control
      </Button>
      <button
        type="button"
        aria-label={`${rw.runtimeLabel} details`}
        onClick={() => onOpen(rw.id)}
        className="absolute inset-0 rounded-md focus-visible:outline focus-visible:outline-2"
      />
    </div>
  );
}
