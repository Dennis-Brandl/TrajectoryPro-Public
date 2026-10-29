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
import { describe, it, expect, beforeEach } from 'vitest';
import { usePrincipalStore, principalHasRight } from './principalStore';

beforeEach(() => usePrincipalStore.getState().clearPrincipal());

describe('principalStore', () => {
  it('administrator short-circuits every right', () => {
    const admin = { id: 'a', email: 'a', loginName: 'admin', displayName: 'A', accessLevel: 'administrator', isAdministrator: true, rights: [], missionSystemCommanderOf: [] };
    expect(principalHasRight(admin, 'work_center:delete')).toBe(true);
  });
  it('viewer only has its read rights', () => {
    const viewer = { id: 'v', email: 'v', loginName: 'admin', displayName: 'V', accessLevel: 'viewer', isAdministrator: false, rights: ['work_center:read'], missionSystemCommanderOf: [] };
    expect(principalHasRight(viewer, 'work_center:read')).toBe(true);
    expect(principalHasRight(viewer, 'work_center:edit')).toBe(false);
  });
  it('null principal has no rights', () => { expect(principalHasRight(null, 'work_center:read')).toBe(false); });
  it('set/clear updates the store', () => {
    const v = { id: 'v', email: 'v', loginName: 'admin', displayName: 'V', accessLevel: 'viewer', isAdministrator: false, rights: [], missionSystemCommanderOf: [] };
    usePrincipalStore.getState().setPrincipal(v);
    expect(usePrincipalStore.getState().principal?.id).toBe('v');
    usePrincipalStore.getState().clearPrincipal();
    expect(usePrincipalStore.getState().principal).toBeNull();
  });
});
