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
import { useKeyedView } from './useKeyedView';

// ONE hook, in an EXPLICIT order — never two separate afterEach registrations. Vitest's default
// `sequence.hooks: 'stack'` runs afterEach hooks in REVERSE registration order, so a separate
// `afterEach(cleanup); afterEach(() => vi.restoreAllMocks());` pair would run restore FIRST and
// leave a window in which this file's still-MOUNTED tree faced module mocks that
// vi.restoreAllMocks() had already reset to bare vi.fn()s returning `undefined` — cleanup()'s own
// act() flushes any passive effect still pending for an already-committed tree, so a mount landing
// in that window would crash on `undefined.then` (see RuntimeTab.test.tsx). cleanup() first means
// every flush it triggers still sees live mocks.
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};

describe('useKeyedView', () => {
  it('a key change keeps the stale view mounted until the new fetch resolves (no flash to null)', async () => {
    const first = deferred<{ tag: string }>();
    const second = deferred<{ tag: string }>();
    const fetcher = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result, rerender } = renderHook(({ key }) => useKeyedView(key, fetcher, 'fail'), {
      initialProps: { key: 'a' },
    });
    await act(async () => { first.resolve({ tag: 'v1' }); });
    await waitFor(() => expect(result.current.view).toEqual({ tag: 'v1' }));

    rerender({ key: 'b' }); // key change — must NOT null the view
    expect(result.current.view).toEqual({ tag: 'v1' });
    expect(result.current.loading).toBe(true);

    await act(async () => { second.resolve({ tag: 'v2' }); });
    await waitFor(() => expect(result.current.view).toEqual({ tag: 'v2' }));
  });

  it('discards a superseded in-flight response (monotonic token)', async () => {
    const first = deferred<{ tag: string }>();
    const second = deferred<{ tag: string }>();
    const fetcher = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useKeyedView('a', fetcher, 'fail'));
    act(() => { result.current.refresh(); }); // second request in flight, supersedes the mount fetch
    await act(async () => { second.resolve({ tag: 'new' }); });
    await act(async () => { first.resolve({ tag: 'old' }); }); // stale — must be ignored
    await waitFor(() => expect(result.current.view).toEqual({ tag: 'new' }));
  });

  it('an error keeps the stale view, sets error, and toasts', async () => {
    const first = deferred<{ tag: string }>();
    const fetcher = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockImplementationOnce(async () => { throw new Error('boom'); });
    const { result } = renderHook(() => useKeyedView('a', fetcher, 'could not load'));
    await act(async () => { first.resolve({ tag: 'v1' }); });
    await waitFor(() => expect(result.current.view).toEqual({ tag: 'v1' }));

    act(() => { result.current.refresh(); });
    await waitFor(() => expect(result.current.error).toBe('could not load'));
    expect(result.current.view).toEqual({ tag: 'v1' }); // stale view survives the error
    expect(result.current.loading).toBe(false);
  });

  it('refresh() always refetches the current (unchanged) key', async () => {
    const fetcher = vi.fn(async () => ({ n: Math.random() }));
    const { result } = renderHook(() => useKeyedView('a', fetcher, 'fail'));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    act(() => { result.current.refresh(); });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  });

  it('a null key clears the view and never fetches', async () => {
    const fetcher = vi.fn(async () => ({ tag: 'x' }));
    const { result } = renderHook(() => useKeyedView(null, fetcher, 'fail'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.view).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
