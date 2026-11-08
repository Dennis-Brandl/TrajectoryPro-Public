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
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';

const { offline, navigate, get, parameters, create, layout, wcMode, blocker, toast } = vi.hoisted(() => ({
  offline: { value: false },
  navigate: vi.fn(), get: vi.fn(), parameters: vi.fn(), create: vi.fn(),
  layout: { value: 'desktop' as string }, wcMode: { value: 'full' as string },
  blocker: { fn: null as null | ((a: unknown) => boolean) },
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('@tanstack/react-router', async (orig) => {
  const actual = await orig<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    useNavigate: () => navigate,
    useBlocker: (o: { shouldBlockFn: (a: unknown) => boolean }) => { blocker.fn = o.shouldBlockFn; },
  };
});
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/api/work-centers', () => ({ workCenters: { get } }));
vi.mock('@/lib/api/runtime-workflows', () => ({ runtimeWorkflows: { parameters, create } }));
vi.mock('~/components/shell/WorkCenterShell', () => ({ useWorkCenter: () => ({ id: 'wc1', name: 'Alpha', mode: wcMode.value }) }));
vi.mock('~/components/running/connection', async (orig) => {
  const actual = await orig<typeof import('~/components/running/connection')>();
  return { ...actual, useConnection: () => ({ offline: offline.value }) };
});
vi.mock('~/lib/layout', () => ({ useLayout: () => layout.value }));
vi.mock('~/components/running/useSplitView', () => ({ useSplitView: () => layout.value === 'desktop' }));

import { NewView } from './NewView';
import { useStartFormStore } from './startFormStore';
import { ConnectionProvider } from '~/components/running/connection';

const show = (selectedId?: string) => render(<ConnectionProvider><NewView selectedId={selectedId} /></ConnectionProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  offline.value = false; layout.value = 'desktop'; wcMode.value = 'full'; blocker.fn = null;
  useStartFormStore.setState({ values: {} });
  get.mockResolvedValue({ workflows: [
    { id: 'w1', name: 'Blend', version: '1.0', state: 'Released' },
    { id: 'w2', name: 'Granulate', version: '0.3', state: 'Draft' },
  ] });
  parameters.mockResolvedValue({ workflowId: 'w2', parameters: [
    { id: 'Batch', description: 'Batch number', defaultValue: '', valueType: 'literal' },
    { id: 'Site', description: null, defaultValue: 'Plant 1', valueType: 'property' },
  ] });
  create.mockResolvedValue({ id: 'r9', runtimeLabel: 'RT-9', status: 'running' });
});
afterEach(cleanup);

describe('NewView', () => {
  it('shows a Draft badge and still allows starting it', async () => {
    show('w2');
    await screen.findByLabelText('Batch');
    expect(screen.getAllByText('Draft').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled();
    expect(screen.queryByText('Released')).toBeNull();
  });

  it('starts with the entered values only and navigates to the runtime', async () => {
    show('w2');
    fireEvent.change(await screen.findByLabelText('Batch'), { target: { value: 'B-7' } });
    expect(screen.getByPlaceholderText('Resolved at start: Plant 1')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith('w2', { Batch: 'B-7' }, { start: true }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/wc/$wcId/running/$runtimeId', params: { wcId: 'wc1', runtimeId: 'r9' } }));
    expect(toast.success).toHaveBeenCalledWith('RT-9 started');
    expect(useStartFormStore.getState().values.w2).toBeUndefined();
  });

  it('has exactly one create button', async () => {
    show('w2');
    await screen.findByLabelText('Batch');
    expect(screen.queryByRole('button', { name: /create and wait|start later/i })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Start' })).toHaveLength(1);
  });

  it('disables Start in view-only and when offline-free loading', async () => {
    wcMode.value = 'view-only';
    show('w2');
    await screen.findByLabelText('Batch');
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });

  it('keeps typed values across a layout switch', async () => {
    const view = show('w2');
    fireEvent.change(await screen.findByLabelText('Batch'), { target: { value: 'B-7' } });
    layout.value = 'phone';
    view.rerender(<ConnectionProvider><NewView selectedId="w2" /></ConnectionProvider>);
    expect(await screen.findByLabelText('Batch')).toHaveValue('B-7');
  });

  it('selecting a workflow navigates to it', async () => {
    show();
    fireEvent.click(await screen.findByText('Blend'));
    expect(navigate).toHaveBeenCalledWith({ to: '/wc/$wcId/new/$workflowId', params: { wcId: 'wc1', workflowId: 'w1' } });
  });

  it('on phone the list is replaced by the form with a Back button', async () => {
    layout.value = 'phone';
    show('w2');
    await screen.findByLabelText('Batch');
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/wc/$wcId/new', params: { wcId: 'wc1' } });
  });

  it('asks before leaving with typed values', async () => {
    show('w2');
    fireEvent.change(await screen.findByLabelText('Batch'), { target: { value: 'B-7' } });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    expect(blocker.fn!({ next: { routeId: '/_xo/wc/$wcId/running' } })).toBe(true);
    expect(confirm).toHaveBeenCalledWith('Discard entered parameter values?');
    confirm.mockReturnValue(true);
    expect(blocker.fn!({ next: { routeId: '/_xo/wc/$wcId/running' } })).toBe(false);
    expect(useStartFormStore.getState().values.w2).toBeUndefined();
  });

  it('does not ask when nothing was typed', async () => {
    show('w2');
    await screen.findByLabelText('Batch');
    const confirm = vi.spyOn(window, 'confirm');
    expect(blocker.fn!({ next: { routeId: '/_xo/wc/$wcId/running' } })).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('does not ask when the typed values were deleted again', async () => {
    show('w2');
    const input = await screen.findByLabelText('Batch');
    fireEvent.change(input, { target: { value: 'B' } });
    fireEvent.change(input, { target: { value: '' } });
    const confirm = vi.spyOn(window, 'confirm');
    expect(blocker.fn!({ next: { routeId: '/_xo/wc/$wcId/running' } })).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('disables Start when offline', async () => {
    offline.value = true;
    show('w2');
    await screen.findByLabelText('Batch');
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });

  it('creates once on a double tap and stays disabled after success', async () => {
    show('w2');
    await screen.findByLabelText('Batch');
    const btn = screen.getByRole('button', { name: 'Start' });
    await act(async () => { fireEvent.click(btn); fireEvent.click(btn); });
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(create).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });

  it('re-enables Start after a failed create', async () => {
    create.mockRejectedValueOnce(new Error('boom'));
    show('w2');
    await screen.findByLabelText('Batch');
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled());
  });
});
