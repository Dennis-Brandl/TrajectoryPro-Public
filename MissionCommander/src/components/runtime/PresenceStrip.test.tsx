// @vitest-environment jsdom
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
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import { runtimeWorkflows } from '@/lib/api/runtime-workflows';
import type { WorkCenterPresenceEntry } from '@/lib/api/types';
import { PresenceStrip } from './PresenceStrip';

vi.mock('@/lib/api/runtime-workflows', () => ({
  runtimeWorkflows: { presence: vi.fn() },
}));

// ONE hook, cleanup strictly first — see RuntimeTab.test.tsx's own comment for the p7 flake this
// ordering closes (Vitest runs afterEach in REVERSE registration order, so a separate
// `afterEach(() => vi.restoreAllMocks())` would neuter the mocks while this file's usePolledView
// tree is still mounted and cleanup() has yet to flush its pending passive effects).
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('PresenceStrip', () => {
  it('lists online and away users with a status dot each', async () => {
    const presence: WorkCenterPresenceEntry[] = [
      { userId: 'u1', name: 'Op One', status: 'online', since: '2026-08-01T00:00:00Z' },
      { userId: 'u2', name: 'Op Two', status: 'away', since: '2026-08-01T00:00:00Z' },
    ];
    vi.mocked(runtimeWorkflows.presence).mockResolvedValue({ presence });
    const { container } = render(<PresenceStrip workCenterId="w1" />);

    expect(await screen.findByText('Op One')).toBeInTheDocument();
    expect(screen.getByText('Op Two')).toBeInTheDocument();
    expect(container.querySelectorAll('.bg-emerald-500')).toHaveLength(1); // online dot
    expect(container.querySelectorAll('.bg-amber-500')).toHaveLength(1); // away dot
  });

  it('renders nothing when presence is empty', async () => {
    vi.mocked(runtimeWorkflows.presence).mockResolvedValue({ presence: [] });
    const { container } = render(<PresenceStrip workCenterId="w1" />);
    await waitFor(() => expect(runtimeWorkflows.presence).toHaveBeenCalled());
    // Explicit async flush: the pre-load render is ALSO empty (usePolledView's initial
    // `view === null`), so an assertion right after the mock-called check would pass even
    // if the resolved-empty-state branch were broken. Draining the microtask queue with a
    // macrotask tick guarantees the fetch's .then/.catch/.finally chain has run and the
    // resulting setState has committed before we assert — the assertion runs against the
    // RESOLVED empty state, not the pre-load one.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(container).toBeEmptyDOMElement();
  });
});
