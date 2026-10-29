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
import { colorFor, humaniseState } from './state';
import { isForceCompletable } from '../force-completable';

describe('WAITING_SCRIPT (spec 2026-10-13 §6.7)', () => {
  it('reads "Running script" and is drawn like EXECUTING', () => {
    expect(humaniseState('WAITING_SCRIPT')).toBe('Running script');
    expect(colorFor('WAITING_SCRIPT')).toEqual(colorFor('EXECUTING'));
  });
  it('only a waiting gate or a waiting repeating script can be forced', () => {
    expect(isForceCompletable('GATE', 'WAITING_GATE')).toBe(true);
    expect(isForceCompletable('SCRIPT', 'WAITING_SCRIPT')).toBe(true);
    expect(isForceCompletable('SCRIPT', 'COMPLETED')).toBe(false);
    expect(isForceCompletable('ACTION PROXY', 'WAITING_ACTION')).toBe(false);
  });
});
