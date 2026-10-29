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
import { DaoError, assertDispatchPolicy, pgErrorCode } from './errors.js';

test('DaoError carries a machine-readable code', () => {
  const e = new DaoError('WORK_CENTER_CYCLE');
  expect(e).toBeInstanceOf(Error);
  expect(e.code).toBe('WORK_CENTER_CYCLE');
});

test('assertDispatchPolicy allows null/undefined/valid, rejects unknown', () => {
  expect(() => assertDispatchPolicy(null)).not.toThrow();
  expect(() => assertDispatchPolicy(undefined)).not.toThrow();
  expect(() => assertDispatchPolicy('least_queued_steps')).not.toThrow();
  expect(() => assertDispatchPolicy('bogus')).toThrow(DaoError);
});

test('pgErrorCode unwraps direct and drizzle-wrapped pg errors', () => {
  expect(pgErrorCode({ code: '23503' })).toBe('23503');
  expect(pgErrorCode({ cause: { code: '23505' } })).toBe('23505');
  expect(pgErrorCode({ code: '23502', cause: { code: '99999' } })).toBe('23502'); // direct wins
  expect(pgErrorCode(new Error('plain'))).toBeUndefined();
  expect(pgErrorCode(null)).toBeUndefined();
  expect(pgErrorCode({ code: 42 })).toBeUndefined(); // non-string code is not a SQLSTATE
});
