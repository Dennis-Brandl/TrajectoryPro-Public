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
import { dayLabel, defaultHistoryFilters } from './history-filters';

describe('history filters', () => {
  it('defaults to local midnight seven days back', () => {
    expect(defaultHistoryFilters(new Date('2026-11-07T15:00')).from).toBe('2026-10-31T00:00');
  });
  it('labels today and yesterday', () => {
    const now = new Date('2026-11-07T15:00');
    expect(dayLabel(new Date('2026-11-07T01:00').toISOString(), now)).toBe('Today');
    expect(dayLabel(new Date('2026-11-06T23:00').toISOString(), now)).toBe('Yesterday');
  });
});
