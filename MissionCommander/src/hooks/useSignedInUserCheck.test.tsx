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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup, waitFor } from '@testing-library/react';

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth/auth-client', () => ({ authClient: { getSession } }));

import { useSignedInUserCheck } from './useSignedInUserCheck';

const reload = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('location', { ...window.location, reload });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('useSignedInUserCheck', () => {
  it('reloads when the browser is now signed in as someone else', async () => {
    getSession.mockResolvedValue({ data: { user: { id: 'john' } } });
    renderHook(() => useSignedInUserCheck('george'));
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it('leaves the page alone while the shown user is still the one signed in', async () => {
    getSession.mockResolvedValue({ data: { user: { id: 'george' } } });
    renderHook(() => useSignedInUserCheck('george'));
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(getSession).toHaveBeenCalled());
    expect(reload).not.toHaveBeenCalled();
  });

  it('leaves the page alone when signed out or offline', async () => {
    getSession.mockResolvedValueOnce({ data: null }).mockRejectedValueOnce(new Error('offline'));
    renderHook(() => useSignedInUserCheck('george'));
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(getSession).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(getSession).toHaveBeenCalledTimes(2));
    expect(reload).not.toHaveBeenCalled();
  });
});
