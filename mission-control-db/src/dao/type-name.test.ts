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
import { normalizeTypeName, lenientTypeName, TYPE_NAME_TOO_LONG_MESSAGE } from './type-name.js';

test('normalizeTypeName trims, blanks to null, keeps case', () => {
  expect(normalizeTypeName('  Production Line  ')).toBe('Production Line');
  expect(normalizeTypeName('   ')).toBeNull();
  expect(normalizeTypeName(null)).toBeNull();
  expect(normalizeTypeName('my cell')).toBe('my cell');
});

test('normalizeTypeName enforces 50 chars after trimming', () => {
  expect(normalizeTypeName('x'.repeat(50))).toBe('x'.repeat(50));
  expect(normalizeTypeName(' ' + 'x'.repeat(50) + ' ')).toBe('x'.repeat(50));
  expect(() => normalizeTypeName('x'.repeat(51))).toThrow(TYPE_NAME_TOO_LONG_MESSAGE);
  try { normalizeTypeName('x'.repeat(51)); } catch (e) {
    expect((e as { code: string }).code).toBe('TYPE_NAME_TOO_LONG');
    expect((e as Error).message).toBe('Type must be 50 characters or fewer.');
  }
});

test('lenientTypeName never throws', () => {
  expect(lenientTypeName(42)).toBeNull();
  expect(lenientTypeName(undefined)).toBeNull();
  expect(lenientTypeName('   ')).toBeNull();
  expect(lenientTypeName('x'.repeat(51))).toBeNull();
  expect(lenientTypeName(' Operation ')).toBe('Operation');
});
