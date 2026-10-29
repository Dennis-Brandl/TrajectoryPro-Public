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
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { useResourceView } from './useResourceView';

afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};

describe('useResourceView', () => {
  it('loads a view for an id and clears loading', async () => {
    const fetcher = vi.fn(async (id: string) => ({ id }));
    const { result } = renderHook(() => useResourceView('a', fetcher, 'fail'));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.view).toEqual({ id: 'a' });
  });

  it('null id yields no view, not loading', async () => {
    const fetcher = vi.fn(async (id: string) => ({ id }));
    const { result } = renderHook(() => useResourceView(null, fetcher, 'fail'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.view).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('drops a stale in-flight response when refresh() supersedes it', async () => {
    const first = deferred<{ tag: string }>();
    const second = deferred<{ tag: string }>();
    const fetcher = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useResourceView('a', fetcher, 'fail'));
    act(() => { result.current.refresh(); });          // second request in flight
    await act(async () => { second.resolve({ tag: 'new' }); });
    await act(async () => { first.resolve({ tag: 'old' }); }); // stale — must be ignored
    await waitFor(() => expect(result.current.view).toEqual({ tag: 'new' }));
  });

  it('setView drops the view in and a later stale refresh cannot clobber it', async () => {
    const inflight = deferred<{ tag: string }>();
    const fetcher = vi.fn().mockReturnValueOnce(inflight.promise);
    const { result } = renderHook(() => useResourceView('a', fetcher, 'fail'));
    act(() => { result.current.setView({ tag: 'mutation' }); }); // bumps token
    await act(async () => { inflight.resolve({ tag: 'stale' }); }); // superseded by setView
    await waitFor(() => expect(result.current.view).toEqual({ tag: 'mutation' }));
  });

  it('setView clears a loading latch left by a superseded in-flight refresh', async () => {
    const first = deferred<{ tag: string }>();
    const second = deferred<{ tag: string }>(); // never resolved in this test — genuinely stuck in flight
    const fetcher = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useResourceView('a', fetcher, 'fail'));
    await act(async () => { first.resolve({ tag: 'v1' }); });
    await waitFor(() => expect(result.current.view).toEqual({ tag: 'v1' }));
    act(() => { result.current.refresh(); });          // second request in flight, will never settle
    expect(result.current.loading).toBe(true);
    act(() => { result.current.setView({ tag: 'mutation' }); }); // drop-in supersedes the stuck refresh
    expect(result.current.loading).toBe(false); // today it latches true — the stuck fetch's .finally never runs
    expect(result.current.view).toEqual({ tag: 'mutation' });
  });

  it('surfaces the fallback message on fetch failure', async () => {
    const fetcher = vi.fn(async () => { throw new Error('boom'); });
    const { result } = renderHook(() => useResourceView('a', fetcher, 'could not load'));
    await waitFor(() => expect(result.current.error).toBe('could not load'));
  });

  it('keeps the previous view mounted while an imperative refresh revalidates (no flash to null)', async () => {
    const first = deferred<{ tag: string }>();
    const second = deferred<{ tag: string }>();
    const fetcher = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useResourceView('a', fetcher, 'fail'));
    await act(async () => { first.resolve({ tag: 'v1' }); });
    await waitFor(() => expect(result.current.view).toEqual({ tag: 'v1' }));
    act(() => { result.current.refresh(); });               // imperative same-id refresh
    // During revalidation the prior view must remain mounted (loading && view stays populated)
    expect(result.current.view).toEqual({ tag: 'v1' });
    expect(result.current.loading).toBe(true);
    await act(async () => { second.resolve({ tag: 'v2' }); });
    await waitFor(() => expect(result.current.view).toEqual({ tag: 'v2' }));
  });

  it('does not refetch when errorFallback identity changes across renders', async () => {
    const fetcher = vi.fn(async (id: string) => ({ id }));
    const { result, rerender } = renderHook(
      ({ fallback }) => useResourceView('a', fetcher, fallback),
      { initialProps: { fallback: 'fail-1' } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetcher).toHaveBeenCalledTimes(1);
    rerender({ fallback: 'fail-2' }); // today: a new errorFallback re-identifies refresh → refetch
    rerender({ fallback: 'fail-3' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.view).toEqual({ id: 'a' }); // never cleared by the [refresh] effect either
  });
});
