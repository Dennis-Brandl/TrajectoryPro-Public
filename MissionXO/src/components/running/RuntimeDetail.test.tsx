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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const { toast, refresh, polled } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  refresh: vi.fn(),
  // One stable object: a fresh view per render would loop RuntimeDetail's [view] effect.
  polled: { view: { detail: {
    summary: { id: 'r1', status: 'running', runtimeLabel: 'RT-1', masterName: 'Flow', masterVersion: '1.0.0', startedAt: null, createdByName: null },
    steps: [], trace: [], signatures: [], operatorCleanup: { stop: false, abort: false },
  } }, loading: false, error: null, stale: false, refresh: () => {} },
}));
vi.mock('sonner', () => ({ toast }));
vi.mock('~/stores/meStore', () => ({ useMeStore: { getState: () => ({ refresh }) } }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/lib/hooks/usePolledView', () => ({ usePolledView: () => polled }));
vi.mock('~/components/shell/WorkCenterShell', () => ({ useWorkCenter: () => ({ id: 'wc1', name: 'WC', mode: 'full' }) }));
vi.mock('~/lib/layout', () => ({ useLayout: () => 'desktop' }));
vi.mock('./useSplitView', () => ({ useSplitView: () => true }));
vi.mock('./connection', () => ({ useConnection: () => ({ offline: false }), useReportConnection: () => () => {} }));
vi.mock('./RuntimeControls', () => ({ RuntimeControls: () => null }));
vi.mock('./RuntimeChildren', () => ({ RuntimeChildren: () => null }));
vi.mock('./ReadOnlySharedState', () => ({ ReadOnlySharedState: () => null }));
// Commander's diagram: its tooltip Force complete reports a failure through onForceCompleteError.
vi.mock('@/components/runtime/RuntimeDiagramCard', async () => {
  const { ApiError } = await import('@/lib/api/client');
  return {
    RuntimeDiagramCard: ({ onForceCompleteError }: { onForceCompleteError?: (err: unknown) => void }) => (
      <button type="button" onClick={() => onForceCompleteError?.(new ApiError(403, 'forbidden', 'Forbidden'))}>diagram force</button>
    ),
  };
});

import { VIEW_ONLY_TEXT } from '~/lib/view-only';
import { RuntimeDetail } from './RuntimeDetail';

beforeEach(() => { vi.clearAllMocks(); refresh.mockResolvedValue(undefined); });
afterEach(cleanup);

describe('RuntimeDetail', () => {
  it("a 403 from the diagram's Force complete shows the view-only text and refreshes the principal", () => {
    render(<RuntimeDetail runtimeId="r1" />);
    fireEvent.click(screen.getByRole('button', { name: 'diagram force' }));
    expect(toast.error).toHaveBeenCalledWith(VIEW_ONLY_TEXT);
    expect(refresh).toHaveBeenCalled();
  });
});
