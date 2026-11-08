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
import { describe, it, expect } from 'vitest';
import type { RuntimeLiveStep, RuntimeWorkflowMonitorSummary } from '@/lib/api/types';
import { isWaitingForOperator, needsAttention, splitByAttention, waitingMinutes } from './attention';

const rt = (id: string, status: string, activeSteps: unknown[] = []) =>
  ({ id, status, activeSteps }) as unknown as RuntimeWorkflowMonitorSummary;
const live = (over: Partial<RuntimeLiveStep>) =>
  ({ stepType: 'USER', state: 'WAITING_USER', startedAt: null, assignment: { id: 'a', status: 'offered', claimant: null }, ...over }) as unknown as RuntimeLiveStep;

describe('needsAttention', () => {
  it('is true for paused and errored only', () => {
    expect(needsAttention(rt('1', 'paused'))).toBe(true);
    expect(needsAttention(rt('2', 'errored'))).toBe(true);
    expect(needsAttention(rt('3', 'running'))).toBe(false);
    expect(needsAttention(rt('4', 'completed'))).toBe(false);
  });
  it('does not flag a running runtime that waits for an operator', () => {
    const r = rt('5', 'running', [{ stepType: 'USER', state: 'WAITING_USER', claimant: null }]);
    expect(needsAttention(r)).toBe(false);
    expect(isWaitingForOperator(r.activeSteps[0])).toBe(true);
  });
});

describe('splitByAttention', () => {
  it('splits and keeps order within each group', () => {
    const rows = [rt('a', 'running'), rt('b', 'paused'), rt('c', 'running'), rt('d', 'errored')];
    const { attention, rest } = splitByAttention(rows);
    expect(attention.map((r) => r.id)).toEqual(['b', 'd']);
    expect(rest.map((r) => r.id)).toEqual(['a', 'c']);
  });
});

describe('isWaitingForOperator', () => {
  it('list rows: WAITING_USER and unclaimed', () => {
    expect(isWaitingForOperator({ stepType: 'USER', state: 'WAITING_USER', claimant: null })).toBe(true);
    expect(isWaitingForOperator({ stepType: 'USER', state: 'WAITING_USER', claimant: { id: 'u' } })).toBe(false);
    expect(isWaitingForOperator({ stepType: 'USER', state: 'RUNNING', claimant: null })).toBe(false);
  });
  it('live rows: offered assignment only', () => {
    expect(isWaitingForOperator(live({}))).toBe(true);
    expect(isWaitingForOperator(live({ assignment: { id: 'a', status: 'claimed', claimant: null } }))).toBe(false);
    expect(isWaitingForOperator(live({ assignment: null }))).toBe(false);
  });
});

describe('waitingMinutes', () => {
  const now = Date.parse('2026-11-07T12:00:00Z');
  it('is whole minutes since startedAt', () => {
    expect(waitingMinutes(live({ startedAt: '2026-11-07T11:47:30Z' }), now)).toBe(12);
  });
  it('is null for a claimed step, a missing start, or a non-waiting step', () => {
    expect(waitingMinutes(live({ startedAt: '2026-11-07T11:47:30Z', assignment: { id: 'a', status: 'claimed', claimant: null } }), now)).toBeNull();
    expect(waitingMinutes(live({ startedAt: null }), now)).toBeNull();
    expect(waitingMinutes(live({ state: 'RUNNING', startedAt: '2026-11-07T11:47:30Z' }), now)).toBeNull();
  });
  it('never goes negative', () => {
    expect(waitingMinutes(live({ startedAt: '2026-11-07T12:05:00Z' }), now)).toBe(0);
  });
});
