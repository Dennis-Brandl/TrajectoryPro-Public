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
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api/client';
import { useActionRunner } from './useActionRunner';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());

describe('useActionRunner', () => {
  it('success: runs the call, toasts the ok copy, refreshes, and drops busy', async () => {
    const refresh = vi.fn();
    const call = vi.fn(async () => ({ ok: true }));
    const { result } = renderHook(() => useActionRunner(refresh));
    expect(result.current.busy).toBe(false);
    await act(async () => { await result.current.run(call, 'Released', 'Release failed'); });
    expect(call).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('Released');
    expect(toast.error).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(false);
  });

  it('failure: toasts the server message (or the fallback) and STILL refreshes — a 409 means the live picture moved', async () => {
    const refresh = vi.fn();
    const { result } = renderHook(() => useActionRunner(refresh));
    await act(async () => { await result.current.run(async () => { throw new ApiError(409, 'conflict', 'nothing to release'); }, 'ok', 'Release failed'); });
    expect(toast.error).toHaveBeenCalledWith('nothing to release');
    await act(async () => { await result.current.run(async () => { throw new Error('boom'); }, 'ok', 'Release failed'); });
    expect(toast.error).toHaveBeenLastCalledWith('Release failed');
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(result.current.busy).toBe(false);
  });

  it('busy is true while the call is in flight', async () => {
    let resolve!: () => void;
    const pending = new Promise<void>((r) => { resolve = r; });
    const { result } = renderHook(() => useActionRunner(() => {}));
    let done: Promise<void>;
    act(() => { done = result.current.run(() => pending, 'ok', 'fail'); });
    expect(result.current.busy).toBe(true);
    await act(async () => { resolve(); await done; });
    expect(result.current.busy).toBe(false);
  });
});
