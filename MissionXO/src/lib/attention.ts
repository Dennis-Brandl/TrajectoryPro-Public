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
import type { RuntimeLiveStep, RuntimeWorkflowMonitorSummary } from '@/lib/api/types';

/** A runtime needs the Steward's attention when it is paused or errored. */
export function needsAttention(r: RuntimeWorkflowMonitorSummary): boolean {
  return r.status === 'paused' || r.status === 'errored';
}

/** Attention rows first group, everything else second; order kept within each. */
export function splitByAttention(rows: RuntimeWorkflowMonitorSummary[]): {
  attention: RuntimeWorkflowMonitorSummary[];
  rest: RuntimeWorkflowMonitorSummary[];
} {
  const attention: RuntimeWorkflowMonitorSummary[] = [];
  const rest: RuntimeWorkflowMonitorSummary[] = [];
  for (const r of rows) (needsAttention(r) ? attention : rest).push(r);
  return { attention, rest };
}

type WaitingStep = { stepType: string; state: string; claimant?: unknown; assignment?: { status: string } | null };

/**
 * A step waits for an operator when it is WAITING_USER and nobody has claimed it.
 * Live rows carry an `assignment` (offered = unclaimed); list rows carry a `claimant`.
 */
export function isWaitingForOperator(step: WaitingStep): boolean {
  if (step.state !== 'WAITING_USER') return false;
  if ('assignment' in step) return step.assignment?.status === 'offered';
  return step.claimant == null;
}

/** Whole minutes a live step has waited for an operator, or null when it is not waiting. */
export function waitingMinutes(step: RuntimeLiveStep, nowMs: number): number | null {
  if (!isWaitingForOperator(step) || !step.startedAt) return null;
  const started = Date.parse(step.startedAt);
  if (Number.isNaN(started)) return null;
  return Math.max(0, Math.floor((nowMs - started) / 60000));
}
