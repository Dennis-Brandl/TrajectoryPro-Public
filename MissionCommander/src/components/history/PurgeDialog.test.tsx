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
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { runtimeHistory } from '@/lib/api/runtime-history';
import { ApiError } from '@/lib/api/client';
import type { WcNode } from '@/lib/api/types';
import { PurgeDialog } from './PurgeDialog';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/api/runtime-history', () => ({
  runtimeHistory: { purgeCount: vi.fn(), purge: vi.fn() },
}));

const WC_NODES: WcNode[] = [
  { id: 'w1', name: 'Assembly', parentWorkCenterId: null, depth: 0, typeName: null },
  { id: 'w2', name: 'Packaging', parentWorkCenterId: null, depth: 0, typeName: null },
];

function setDate(value = '2026-08-01T00:00') {
  fireEvent.change(screen.getByLabelText('Older than'), { target: { value } });
}

// ONE hook, in an EXPLICIT order — never two separate afterEach registrations. Vitest's default
// `sequence.hooks: 'stack'` runs afterEach hooks in REVERSE registration order, so a separate
// `afterEach(cleanup); afterEach(() => vi.restoreAllMocks());` pair would run restore FIRST and
// leave a window in which this file's still-MOUNTED tree faced module mocks that
// vi.restoreAllMocks() had already reset to bare vi.fn()s returning `undefined` — cleanup()'s own
// act() flushes any passive effect still pending for an already-committed tree, so a mount landing
// in that window would crash on `undefined.then` (see RuntimeTab.test.tsx). cleanup() first means
// every flush it triggers still sees live mocks.
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// p7 sweep ticket 4b: PurgeDialog no longer self-fetches the work-center list, so this helper
// no longer needs to wait for one — `workCenters` is passed straight through as a prop.
function renderDialog(onClose = vi.fn(), onPurged = vi.fn()) {
  const utils = render(<PurgeDialog workCenters={WC_NODES} onClose={onClose} onPurged={onPurged} />);
  return { ...utils, onClose, onPurged };
}

describe('PurgeDialog — required date gates the confirm control', () => {
  it('the destructive confirm is disabled while the date field is empty', async () => {
    await renderDialog();
    expect(screen.getByRole('button', { name: /delete.*permanently/i })).toBeDisabled();
  });

  it('the destructive confirm becomes enabled once a valid date is set', async () => {
    vi.mocked(runtimeHistory.purgeCount).mockResolvedValue({ count: 3 });
    await renderDialog();
    setDate();
    await waitFor(() => expect(screen.getByRole('button', { name: /delete.*permanently/i })).toBeEnabled());
  });

  it('clearing the date back to empty disables the confirm again', async () => {
    vi.mocked(runtimeHistory.purgeCount).mockResolvedValue({ count: 3 });
    await renderDialog();
    setDate();
    await waitFor(() => expect(screen.getByRole('button', { name: /delete.*permanently/i })).toBeEnabled());
    setDate('');
    await waitFor(() => expect(screen.getByRole('button', { name: /delete.*permanently/i })).toBeDisabled());
  });
});

describe('PurgeDialog — work-center scope select', () => {
  it('offers All work centers plus each work center by name (no orphans option)', async () => {
    await renderDialog();
    await userEvent.click(screen.getByLabelText('Work center scope'));
    expect(await screen.findByRole('option', { name: 'All work centers' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Assembly' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Packaging' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /deleted work centers/i })).not.toBeInTheDocument();
  });
});

describe('PurgeDialog — live count preview', () => {
  it('fetches purgeCount when the date commits and shows "N history entries match"', async () => {
    const countSpy = vi.mocked(runtimeHistory.purgeCount).mockResolvedValue({ count: 42 });
    await renderDialog();
    expect(screen.queryByText(/history entries match/)).not.toBeInTheDocument();
    setDate('2026-08-01T00:00');
    expect(await screen.findByText('42 history entries match')).toBeInTheDocument();
    expect(countSpy).toHaveBeenLastCalledWith({ olderThan: '2026-08-01T00:00', workCenterId: undefined });
  });

  it('re-fetches purgeCount when the scope changes, scoped to the chosen work center', async () => {
    const countSpy = vi.mocked(runtimeHistory.purgeCount).mockResolvedValue({ count: 5 });
    await renderDialog();
    setDate('2026-08-01T00:00');
    await screen.findByText('5 history entries match');

    vi.mocked(runtimeHistory.purgeCount).mockResolvedValue({ count: 2 });
    await userEvent.click(screen.getByLabelText('Work center scope'));
    await userEvent.click(await screen.findByRole('option', { name: 'Assembly' }));

    await waitFor(() => expect(countSpy).toHaveBeenLastCalledWith({ olderThan: '2026-08-01T00:00', workCenterId: 'w1' }));
    expect(await screen.findByText('2 history entries match')).toBeInTheDocument();
  });

  // Review fix: a failed preview must re-arm the same safety guard a missing date does — the
  // live count is what makes the confirm trustworthy, so losing it must disable the confirm,
  // not fall back to a misleading "Delete 0 …" that undersells what an unscoped/wide purge
  // would actually do.
  it('a failed count preview disables the confirm with an honest label (never "Delete 0…"); a later successful preview re-enables it with the correct count', async () => {
    vi.mocked(runtimeHistory.purgeCount).mockRejectedValueOnce(new ApiError(500, 'internal', 'Boom'));
    await renderDialog();
    setDate('2026-08-01T00:00');

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Boom'));
    const confirm = screen.getByRole('button', { name: /delete.*permanently/i });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveTextContent('Delete history entries permanently?');
    expect(screen.queryByText(/history entries match/)).not.toBeInTheDocument();

    vi.mocked(runtimeHistory.purgeCount).mockResolvedValueOnce({ count: 6 });
    await userEvent.click(screen.getByLabelText('Work center scope'));
    await userEvent.click(await screen.findByRole('option', { name: 'Assembly' }));

    await waitFor(() => expect(confirm).toBeEnabled());
    expect(confirm).toHaveTextContent('Delete 6 history entries permanently?');
  });
});

describe('PurgeDialog — pluralization (ticket 1)', () => {
  it('n=1: preview text, confirm label, and success toast all use the singular "entry"', async () => {
    vi.mocked(runtimeHistory.purgeCount).mockResolvedValue({ count: 1 });
    vi.mocked(runtimeHistory.purge).mockResolvedValue({ deleted: 1 });
    await renderDialog();
    setDate('2026-08-01T00:00');

    expect(await screen.findByText('1 history entry matches')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: /delete.*permanently/i });
    expect(confirm).toHaveTextContent('Delete 1 history entry permanently?');

    await userEvent.click(confirm);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('1 history entry deleted'));
  });

  it('n=2: preview text, confirm label, and success toast all use the plural "entries" with agreeing verb', async () => {
    vi.mocked(runtimeHistory.purgeCount).mockResolvedValue({ count: 2 });
    vi.mocked(runtimeHistory.purge).mockResolvedValue({ deleted: 2 });
    await renderDialog();
    setDate('2026-08-01T00:00');

    expect(await screen.findByText('2 history entries match')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: /delete.*permanently/i });
    expect(confirm).toHaveTextContent('Delete 2 history entries permanently?');

    await userEvent.click(confirm);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('2 history entries deleted'));
  });
});

describe('PurgeDialog — debounced count preview (ticket 3)', () => {
  it('rapid-fire changes to the date collapse into exactly ONE purgeCount call, 300ms after the last one', async () => {
    const countSpy = vi.mocked(runtimeHistory.purgeCount).mockResolvedValue({ count: 5 });
    vi.useFakeTimers();
    try {
      render(<PurgeDialog workCenters={WC_NODES} onClose={vi.fn()} onPurged={vi.fn()} />);

      setDate('2026-08-01T00:00');
      setDate('2026-08-02T00:00');
      setDate('2026-08-03T00:00');
      expect(countSpy).not.toHaveBeenCalled();

      await act(async () => { await vi.advanceTimersByTimeAsync(299); });
      expect(countSpy).not.toHaveBeenCalled();

      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(countSpy).toHaveBeenCalledTimes(1);
      expect(countSpy).toHaveBeenLastCalledWith({ olderThan: '2026-08-03T00:00', workCenterId: undefined });
    } finally {
      vi.useRealTimers();
    }
  });

  it('the confirm stays disabled through the whole debounce window, then enables once the fetch settles', async () => {
    vi.mocked(runtimeHistory.purgeCount).mockResolvedValue({ count: 5 });
    vi.useFakeTimers();
    try {
      render(<PurgeDialog workCenters={WC_NODES} onClose={vi.fn()} onPurged={vi.fn()} />);

      setDate('2026-08-01T00:00');
      const confirm = screen.getByRole('button', { name: /delete.*permanently/i });
      expect(confirm).toBeDisabled();

      await act(async () => { await vi.advanceTimersByTimeAsync(299); });
      expect(confirm).toBeDisabled(); // still within the debounce window

      // Advancing past the debounce boundary also flushes the mocked (already-resolved)
      // fetch's microtasks in the same tick, so "timer fires" and "fetch settles" collapse
      // into one advance here — the two-step assertion above is what actually pins the
      // debounce-window behavior this test exists for.
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(confirm).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('PurgeDialog — confirm flow', () => {
  it('confirming calls purge with the committed date+scope, toasts the deleted count, closes and refreshes', async () => {
    vi.mocked(runtimeHistory.purgeCount).mockResolvedValue({ count: 7 });
    vi.mocked(runtimeHistory.purge).mockResolvedValue({ deleted: 7 });
    const { onClose, onPurged } = await renderDialog();
    setDate('2026-08-01T00:00');
    await screen.findByText('7 history entries match');

    await userEvent.click(screen.getByRole('button', { name: /delete.*permanently/i }));

    await waitFor(() => expect(runtimeHistory.purge).toHaveBeenCalledWith({ olderThan: '2026-08-01T00:00', workCenterId: undefined }));
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('7'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onPurged).toHaveBeenCalled();
  });

  it('scoping to a specific work center sends its id, not unscoped', async () => {
    vi.mocked(runtimeHistory.purgeCount).mockResolvedValue({ count: 1 });
    vi.mocked(runtimeHistory.purge).mockResolvedValue({ deleted: 1 });
    await renderDialog();
    setDate('2026-08-01T00:00');
    await userEvent.click(screen.getByLabelText('Work center scope'));
    await userEvent.click(await screen.findByRole('option', { name: 'Packaging' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /delete.*permanently/i })).toBeEnabled());

    await userEvent.click(screen.getByRole('button', { name: /delete.*permanently/i }));
    await waitFor(() => expect(runtimeHistory.purge).toHaveBeenCalledWith({ olderThan: '2026-08-01T00:00', workCenterId: 'w2' }));
  });

  it('Cancel closes the dialog and never calls purge', async () => {
    vi.mocked(runtimeHistory.purgeCount).mockResolvedValue({ count: 9 });
    const { onClose } = await renderDialog();
    setDate('2026-08-01T00:00');
    await screen.findByText('9 history entries match');

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(runtimeHistory.purge).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('a failed purge shows a toast via apiErrorMessage and keeps the dialog open', async () => {
    vi.mocked(runtimeHistory.purgeCount).mockResolvedValue({ count: 4 });
    vi.mocked(runtimeHistory.purge).mockRejectedValue(new ApiError(500, 'internal', 'Purge exploded'));
    const { onClose, onPurged } = await renderDialog();
    setDate('2026-08-01T00:00');
    await screen.findByText('4 history entries match');

    await userEvent.click(screen.getByRole('button', { name: /delete.*permanently/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Purge exploded'));
    expect(onClose).not.toHaveBeenCalled();
    expect(onPurged).not.toHaveBeenCalled();
  });
});
