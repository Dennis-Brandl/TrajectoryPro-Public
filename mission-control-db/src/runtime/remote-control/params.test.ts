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
import { parseStartingParameters } from './params.js';
import { RemoteError, REMOTE_CODES, runtimeStateName } from './codes.js';

test('blank means no parameters', () => {
  expect(parseStartingParameters('')).toEqual({});
  expect(parseStartingParameters('   ')).toEqual({});
});

test('Value Type form: a whole Value Property, Description dropped', () => {
  const raw = JSON.stringify([
    { name: 'Batch', value: 'B-17' }, { name: 'Qty', value: '40' }, { name: 'description', value: 'ignored' },
  ]);
  expect(parseStartingParameters(raw)).toEqual({ Batch: 'B-17', Qty: '40' });
});

test('JSON object form; numbers and booleans become strings', () => {
  expect(parseStartingParameters('{"Batch":"B-17","Qty":40,"Rush":true}')).toEqual({ Batch: 'B-17', Qty: '40', Rush: 'true' });
});

test('name=value pairs; whitespace trimmed; empty segments skipped; values may contain =', () => {
  expect(parseStartingParameters(' Batch = B-17 ; Qty=40;; Note=a=b ')).toEqual({ Batch: 'B-17', Qty: '40', Note: 'a=b' });
});

test('malformed input is code 5 with a readable message', () => {
  for (const raw of ['[1,2]', '{"a":{"b":1}}', '[{"name":"x"}]', 'Batch', '=v', '{not json']) {
    try { parseStartingParameters(raw); expect.fail(raw); }
    catch (e) {
      expect(e).toBeInstanceOf(RemoteError);
      expect((e as RemoteError).code).toBe(REMOTE_CODES.INVALID_INPUT);
      expect((e as RemoteError).message).toMatch(/^Starting parameters/);
    }
  }
});

test('state names follow ruling R1', () => {
  expect(runtimeStateName('paused')).toBe('Suspended');
  expect(runtimeStateName('pending')).toBe('Created');
  expect(runtimeStateName('errored')).toBe('Errored');
  expect(runtimeStateName(undefined)).toBe('Unknown');
});
