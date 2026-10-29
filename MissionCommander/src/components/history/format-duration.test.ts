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
import { expect, test } from 'vitest';
import { formatDuration } from './format-duration';

test('returns an em dash when startedAt is null', () => {
  expect(formatDuration(null, '2026-08-01T00:00:12.000Z')).toBe('—');
});

test('formats a sub-minute duration as seconds', () => {
  expect(formatDuration('2026-08-01T00:00:00.000Z', '2026-08-01T00:00:12.000Z')).toBe('12s');
});

test('formats a sub-hour duration as minutes and seconds', () => {
  // 4 * 60 + 32 = 272s
  expect(formatDuration('2026-08-01T00:00:00.000Z', '2026-08-01T00:04:32.000Z')).toBe('4m 32s');
});

test('formats an hour-plus duration as hours and zero-padded minutes', () => {
  // 2h 05m = 7500s
  expect(formatDuration('2026-08-01T00:00:00.000Z', '2026-08-01T02:05:00.000Z')).toBe('2h 05m');
});
