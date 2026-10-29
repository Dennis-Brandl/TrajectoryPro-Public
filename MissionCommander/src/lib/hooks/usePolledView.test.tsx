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
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { usePolledView } from './usePolledView';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test('fetches immediately, then on every interval tick; last write wins', async () => {
  let n = 0;
  const fetcher = vi.fn(async () => ({ n: ++n }));
  const { result } = renderHook(() => usePolledView('k1', fetcher, 'failed', 5000));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(result.current.view).toEqual({ n: 1 });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(result.current.view).toEqual({ n: 2 });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test('key change refetches at once; null key clears and stops polling', async () => {
  const fetcher = vi.fn(async () => ({ ok: true }));
  const { result, rerender } = renderHook(({ k }) => usePolledView(k, fetcher, 'failed', 5000), { initialProps: { k: 'a' as string | null } });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  rerender({ k: 'b' });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(fetcher).toHaveBeenCalledTimes(2);
  rerender({ k: null });
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  expect(fetcher).toHaveBeenCalledTimes(2); // no polling on null key
  expect(result.current.view).toBeNull();
});

test('a poll tick is skipped while document.hidden', async () => {
  const fetcher = vi.fn(async () => ({}));
  renderHook(() => usePolledView('k', fetcher, 'failed', 5000));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(fetcher).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test('a poll-tick failure keeps the stale view and does NOT toast (only the first load toasts)', async () => {
  let call = 0;
  const fetcher = vi.fn(async () => { call++; if (call > 1) throw new Error('down'); return { ok: 1 }; });
  const { result } = renderHook(() => usePolledView('k', fetcher, 'failed', 5000));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(result.current.view).toEqual({ ok: 1 }); // stale kept
  expect(result.current.error).toBeNull();        // background failure is silent
});

test('a later success (even from a background tick) clears an error left by the first (foreground) failed load', async () => {
  let call = 0;
  const fetcher = vi.fn(async () => { call++; if (call === 1) throw new Error('down'); return { ok: call }; });
  const { result } = renderHook(() => usePolledView('k', fetcher, 'failed', 5000));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(result.current.error).toBe('failed'); // first (foreground) load's failure surfaces (apiErrorMessage falls back for a plain Error)
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); }); // background tick succeeds
  expect(result.current.view).toEqual({ ok: 2 });
  expect(result.current.error).toBeNull(); // stale error must not survive a later success
});

test('a background tick failure flips `stale` to true while the view is kept', async () => {
  let call = 0;
  const fetcher = vi.fn(async () => { call++; if (call > 1) throw new Error('down'); return { ok: 1 }; });
  const { result } = renderHook(() => usePolledView('k', fetcher, 'failed', 5000));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(result.current.stale).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(result.current.view).toEqual({ ok: 1 }); // stale view kept
  expect(result.current.stale).toBe(true);
});

test('a later success clears `stale` set by an earlier background failure', async () => {
  let call = 0;
  const fetcher = vi.fn(async () => { call++; if (call === 2) throw new Error('down'); return { ok: call }; });
  const { result } = renderHook(() => usePolledView('k', fetcher, 'failed', 5000));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); }); // call 1 succeeds
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); }); // call 2 fails -> stale
  expect(result.current.stale).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); }); // call 3 succeeds -> fresh again
  expect(result.current.stale).toBe(false);
  expect(result.current.view).toEqual({ ok: 3 });
});

test('a foreground (first) load failure leaves `stale` false — that path uses `error` instead', async () => {
  const fetcher = vi.fn(async () => { throw new Error('down'); });
  const { result } = renderHook(() => usePolledView('k', fetcher, 'failed', 5000));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(result.current.error).toBe('failed');
  expect(result.current.stale).toBe(false);
});

test('clears loading when a background tick supersedes a slow first load', async () => {
  const resolvers: Array<(v: { n: number }) => void> = [];
  const fetcher = vi.fn(() => new Promise<{ n: number }>((res) => { resolvers.push(res); }));
  const { result } = renderHook(() => usePolledView('k', fetcher, 'failed', 5000));
  expect(result.current.loading).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); }); // tick supersedes the first load
  expect(resolvers).toHaveLength(2);
  await act(async () => { resolvers[1]({ n: 2 }); });
  await act(async () => { resolvers[0]({ n: 1 }); });
  expect(result.current.view).toEqual({ n: 2 });
  expect(result.current.loading).toBe(false);
});
