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
import { Button, cn } from '@mission/ui';
import type { RuntimeLiveStep } from '@/lib/api/types';
import { isForceCompletable } from '@/components/runtime/force-completable';
import { humaniseState } from '@/components/runtime/diagram/state';
import { useLayout } from '~/lib/layout';
import { waitingMinutes } from '~/lib/attention';

type Handlers = {
  onAssign: (assignmentId: string, stepName: string) => void;
  onForceRelease: (assignmentId: string, stepName: string) => void;
  onForceComplete: (step: RuntimeLiveStep) => void;
};

const QUIET = new Set(['IDLE', 'READY', 'COMPLETED', 'CANCELLED', 'ABORTED']);
const name = (s: RuntimeLiveStep) => s.stepName ?? s.stepOid;

/** The step the Steward is looking at: the first one that is doing or waiting for something. */
export function currentStep(steps: RuntimeLiveStep[]): RuntimeLiveStep | undefined {
  return steps.find((s) => !QUIET.has(s.state));
}

function stateText(s: RuntimeLiveStep, nowMs: number): string {
  const mins = waitingMinutes(s, nowMs);
  if (mins !== null) return `Waiting for operator, ${mins} min`;
  const who = s.assignment?.claimant?.name;
  if (who) return who;
  switch (s.state) {
    case 'COMPLETED': return 'Done';
    case 'IDLE': case 'READY': return 'Not yet';
    case 'WAITING_USER': return 'Waiting';
    default: return humaniseState(s.state);
  }
}

function Actions({ step, canAct, runtimeTerminal, big, onAssign, onForceRelease, onForceComplete }:
  Handlers & { step: RuntimeLiveStep; canAct: boolean; runtimeTerminal: boolean; big: boolean }) {
  if (!canAct || runtimeTerminal) return null;
  const n = name(step);
  const cls = big ? 'min-h-11' : 'min-h-9';
  return (
    <div className="flex flex-wrap gap-2">
      {step.assignment?.status === 'offered' && (
        <Button type="button" variant="outline" size="sm" className={cls} aria-label={`Assign ${n}`}
          onClick={() => onAssign(step.assignment!.id, n)}>Assign…</Button>
      )}
      {step.assignment?.status === 'claimed' && (
        <Button type="button" variant="outline" size="sm" className={cls} aria-label={`Force release ${n}`}
          onClick={() => onForceRelease(step.assignment!.id, n)}>Force release</Button>
      )}
      {isForceCompletable(step.stepType, step.state) && (
        <Button type="button" variant="outline" size="sm" className={cls} aria-label={`Force complete ${n}`}
          onClick={() => onForceComplete(step)}>Force complete…</Button>
      )}
    </div>
  );
}

/** The highlighted NOW card followed by every step, name left, state or operator right. */
export function StepList({ steps, runtimeTerminal, canAct, nowMs, ...handlers }: Handlers & {
  steps: RuntimeLiveStep[]; runtimeTerminal: boolean; canAct: boolean; nowMs: number;
}) {
  const big = useLayout() !== 'desktop';
  const now = runtimeTerminal ? undefined : currentStep(steps);
  return (
    <div className="space-y-4">
      {now && (
        <section aria-label="Now" className="rounded-[10px] border border-selection bg-selection/10 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-selection">Now</div>
          <div className="mt-0.5 text-base font-semibold">{name(now)}</div>
          <div className="mb-2 text-sm text-muted-foreground">{stateText(now, nowMs)}</div>
          <Actions step={now} canAct={canAct} runtimeTerminal={runtimeTerminal} big={big} {...handlers} />
        </section>
      )}
      <section aria-label="Steps" className="space-y-1">
        <h3 className="text-sm font-medium">Steps</h3>
        {steps.length === 0 && <p className="text-sm text-muted-foreground">No steps yet</p>}
        {steps.map((s) => (
          <div key={s.id} className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border py-2 text-sm last:border-0')}>
            <span className="min-w-0 flex-1 truncate">{name(s)}</span>
            <span className="text-muted-foreground">{stateText(s, nowMs)}</span>
            {s !== now && <Actions step={s} canAct={canAct} runtimeTerminal={runtimeTerminal} big={big} {...handlers} />}
            {s.error && <span className="w-full truncate text-xs text-destructive" title={s.error}>{s.error}</span>}
          </div>
        ))}
      </section>
    </div>
  );
}
