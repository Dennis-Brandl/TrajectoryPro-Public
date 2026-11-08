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
import { describe, it, expect } from 'vitest';
import type { WcNode } from '@/lib/api/types';
import { canUseXo, workCenterMode, orderWorkCenters } from './access';

const n = (id: string): WcNode => ({ id, name: id, parentWorkCenterId: null, depth: 0, typeName: 'Cell' });

describe('access', () => {
  it('admits stewards and administrators only', () => {
    expect(canUseXo({ accessLevel: 'steward' })).toBe(true);
    expect(canUseXo({ accessLevel: 'administrator' })).toBe(true);
    expect(canUseXo({ accessLevel: 'viewer' })).toBe(false);
  });
  it('gives full mode to administrators and commanders of the work center', () => {
    expect(workCenterMode({ isAdministrator: true, missionSystemCommanderOf: [] }, 'w1')).toBe('full');
    expect(workCenterMode({ isAdministrator: false, missionSystemCommanderOf: ['w1'] }, 'w1')).toBe('full');
    expect(workCenterMode({ isAdministrator: false, missionSystemCommanderOf: ['w1'] }, 'w2')).toBe('view-only');
  });
  it('orders full work centers first, keeping server order within groups', () => {
    expect(orderWorkCenters([n('a'), n('b'), n('c')], { isAdministrator: false, missionSystemCommanderOf: ['c'] })
      .map((x) => [x.id, x.mode])).toEqual([['c', 'full'], ['a', 'view-only'], ['b', 'view-only']]);
  });
});
