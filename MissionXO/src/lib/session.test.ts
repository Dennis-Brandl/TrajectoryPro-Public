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
import { installUnauthorizedRedirect, installXoAppHeader } from './session';
import { setUnauthorizedHandler, setAppHeaders, get, post } from '@/lib/api/client';
import { XO_AUTH_BASE_PATH } from './auth-client';

afterEach(() => { setUnauthorizedHandler(null); setAppHeaders(null); vi.unstubAllGlobals(); });

// 2026-11-08: XO keeps its own sign-in, so every call it makes must say it is XO's.
describe('installXoAppHeader', () => {
  it('marks every API call, reads and writes alike, as Mission XO', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    installXoAppHeader();
    await get('/api/me');
    await post('/api/workflows/w1/runtime-workflows', { start: true });
    for (const [, init] of fetchMock.mock.calls) {
      expect((init as RequestInit).headers).toMatchObject({ 'X-Mission-App': 'xo' });
    }
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toMatchObject({ 'content-type': 'application/json' });
  });

  it("signs in at XO's own path, not Commander's /api/auth", () => {
    expect(XO_AUTH_BASE_PATH).toBe('/api/xo-auth');
  });
});

describe('installUnauthorizedRedirect', () => {
  it('sends a 401 to /xo/login', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { pathname: '/xo/', assign });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    installUnauthorizedRedirect();
    await get('/api/x').catch(() => {});
    expect(assign).toHaveBeenCalledWith('/xo/login');
  });

  it('does nothing when already on the login page', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { pathname: '/xo/login', assign });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    installUnauthorizedRedirect();
    await get('/api/x').catch(() => {});
    expect(assign).not.toHaveBeenCalled();
  });
});
