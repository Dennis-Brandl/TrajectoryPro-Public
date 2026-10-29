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
import { makeTimeFormatter } from './record-time';

describe('makeTimeFormatter', () => {
  const ref = '2026-10-27T15:00:00Z';
  it('formats date-times in the zone, 24-hour', () => {
    const f = makeTimeFormatter('America/Chicago', ref);
    expect(f.dateTime('2026-10-27T15:04:05Z')).toBe('2026-10-27 10:04:05');
    expect(f.zoneLabel).toBe('America/Chicago (UTC-05:00)');
  });
  it('time() drops the date only on the same local day', () => {
    const f = makeTimeFormatter('America/Chicago', ref);
    expect(f.time('2026-10-27T15:04:05Z', ref)).toBe('10:04:05');
    expect(f.time('2026-10-28T15:04:05Z', ref)).toBe('2026-10-28 10:04:05');
  });
  it('maps GMT to UTC+00:00', () => {
    expect(makeTimeFormatter('UTC', ref).zoneLabel).toBe('UTC (UTC+00:00)');
  });
  it('appends the offset when it differs from the reference, with an ASCII hyphen', () => {
    const f = makeTimeFormatter('America/Chicago', '2026-11-01T06:30:00Z');
    expect(f.time('2026-11-01T07:30:00Z', '2026-11-01T06:30:00Z')).toBe('01:30:00 (UTC-06:00)');
    expect(f.time('2026-11-01T06:45:00Z', '2026-11-01T06:30:00Z')).toBe('01:45:00');
  });
});
