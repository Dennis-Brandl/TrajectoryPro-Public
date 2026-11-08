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
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { RuntimeLiveStep } from '@/lib/api/types';
import { StepList } from './StepList';

const NOW = Date.parse('2026-11-07T12:00:00Z');
const step = (over: Partial<RuntimeLiveStep>): RuntimeLiveStep => ({
  id: 's1', stepOid: 'o1', stepName: 'Weigh', stepType: 'USER', state: 'WAITING_USER', error: null,
  startedAt: new Date(NOW - 12 * 60000).toISOString(), completedAt: null, assignment: { id: 'a1', status: 'offered', claimant: null }, gateTimer: null, ...over,
});

const show = (steps: RuntimeLiveStep[], over = {}) => {
  const fns = { onAssign: vi.fn(), onForceRelease: vi.fn(), onForceComplete: vi.fn() };
  render(<StepList steps={steps} runtimeTerminal={false} canAct nowMs={NOW} {...fns} {...over} />);
  return fns;
};
afterEach(cleanup);

describe('StepList', () => {
  it('shows how long an unclaimed step has waited', () => {
    show([step({})]);
    expect(screen.getAllByText('Waiting for operator, 12 min').length).toBeGreaterThan(0);
  });

  it('shows the claimant and the Assign / Force release / Force complete actions', () => {
    const fns = show([
      step({ id: 'now', stepName: 'Mix', assignment: { id: 'a2', status: 'claimed', claimant: { userId: 'u', name: 'Maria K.', presence: 'online' } } }),
      step({ id: 'g', stepName: 'Hold', stepType: 'GATE', state: 'WAITING_GATE', assignment: null }),
      step({ id: 'w', stepName: 'Pack', assignment: { id: 'a3', status: 'offered', claimant: null } }),
    ]);
    expect(screen.getAllByText('Maria K.').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Force release Mix' }));
    expect(fns.onForceRelease).toHaveBeenCalledWith('a2', 'Mix');
    fireEvent.click(screen.getByRole('button', { name: 'Force complete Hold' }));
    expect(fns.onForceComplete).toHaveBeenCalledWith(expect.objectContaining({ id: 'g' }));
    fireEvent.click(screen.getByRole('button', { name: 'Assign Pack' }));
    expect(fns.onAssign).toHaveBeenCalledWith('a3', 'Pack');
  });

  it('offers Force release but not Assign… on a claimed step (the engine only assigns offered steps)', () => {
    show([step({ stepName: 'Mix', assignment: { id: 'a2', status: 'claimed', claimant: { userId: 'u', name: 'Maria K.', presence: 'online' } } })]);
    expect(screen.getByRole('button', { name: 'Force release Mix' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Assign Mix' })).toBeNull();
  });

  it('hides the actions when the user cannot act', () => {
    show([step({})], { canAct: false });
    expect(screen.queryByRole('button', { name: /Assign/ })).toBeNull();
  });
});
