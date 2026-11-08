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
import { installUnauthorizedRedirect } from './session';
import { setUnauthorizedHandler, get } from '@/lib/api/client';

afterEach(() => { setUnauthorizedHandler(null); vi.unstubAllGlobals(); });

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
