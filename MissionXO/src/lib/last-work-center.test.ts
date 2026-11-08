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
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readLastWorkCenter, writeLastWorkCenter } from './last-work-center';

describe('last work center', () => {
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });
  it('round-trips and starts null', () => {
    expect(readLastWorkCenter()).toBeNull();
    writeLastWorkCenter('w1');
    expect(readLastWorkCenter()).toBe('w1');
    expect(localStorage.getItem('mission-xo-last-work-center')).toBe('w1');
  });
  it('does not throw when storage fails', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readLastWorkCenter()).toBeNull();
    expect(() => writeLastWorkCenter('w1')).not.toThrow();
  });
});
