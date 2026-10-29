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
import { usePrincipalStore } from '@/stores/principalStore';
import * as meMod from '@/lib/api/me';
import { runBoot } from './boot';
import { ApiError } from '@/lib/api/client';

beforeEach(() => usePrincipalStore.getState().clearPrincipal());

describe('runBoot', () => {
  it('loads /me into the principal store', async () => {
    vi.spyOn(meMod, 'me').mockResolvedValue({ id: 'u', email: 'u', loginName: 'admin', displayName: 'U', accessLevel: 'administrator', isAdministrator: true, rights: [], missionSystemCommanderOf: [] });
    const r = await runBoot();
    expect(r.ok).toBe(true);
    expect(usePrincipalStore.getState().principal?.id).toBe('u');
  });
  it('reports error:"me" on a 401', async () => {
    vi.spyOn(meMod, 'me').mockRejectedValue(new ApiError(401, 'unauthorized', ''));
    expect(await runBoot()).toEqual({ ok: false, error: 'me' });
  });
});
