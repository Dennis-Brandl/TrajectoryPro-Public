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

import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validate } from '../src/spec/validator.js';
import { isOperatorMode } from '../src/spec/types.js';

const dir = join(import.meta.dirname, '../src/conformance/fixtures/validation');
const base = (): Record<string, any> =>
  JSON.parse(readFileSync(join(dir, 'val-try-catch-013-operator-modes-workflow-level.json'), 'utf8')).workflow;

describe('Operator TRY modes (spec 2026-11-06)', () => {
  test('accepts OPERATOR_STOP and OPERATOR_ABORT workflow rows', () => {
    expect(validate(base()).valid).toBe(true);
  });

  test('rejects OPERATOR_STOP on a step', () => {
    const wf = base();
    delete wf.try_specifications;
    wf.steps[1].try_specifications = [{ mode: 'OPERATOR_STOP', catch_id: 'C1' }];
    const r = validate(wf);
    expect(r.valid).toBe(false);
    expect(r.error_code).toBe('INVALID_TRY_MODE');
    expect(r.error_message).toContain('s2');
  });

  test('rejects duplicate OPERATOR_STOP workflow rows', () => {
    const wf = base();
    wf.try_specifications = [
      { mode: 'OPERATOR_STOP', catch_id: 'C1' },
      { mode: 'OPERATOR_STOP', catch_id: 'C1' },
    ];
    expect(validate(wf).error_code).toBe('DUPLICATE_TRY_MODE');
  });

  test('accepts operator rows on a child workflow export', () => {
    const wf = base();
    wf.children = [{
      local_id: 'child', oid: 'child-1', version: '1.0.0', last_modified_date: '2026-05-31T12:00:00.000Z',
      schemaVersion: '4.0', parentChildSpecId: null, state: 'RELEASED', steps: [], connections: [],
      try_specifications: [{ mode: 'OPERATOR_ABORT', catch_id: 'C1' }],
    }];
    const r = validate(wf); expect(r.error_message).toBeUndefined(); expect(r.valid).toBe(true);
  });

  test('rejects an operator mode on a child workflow step row in the schema', () => {
    const wf = base();
    wf.children = [{
      local_id: 'child', oid: 'child-1', version: '1.0.0', last_modified_date: '2026-05-31T12:00:00.000Z',
      schemaVersion: '4.0', parentChildSpecId: null, state: 'RELEASED', steps: [{
        local_id: 'S', oid: 'cs1', version: '1.0.0', last_modified_date: '2026-05-31T12:00:00.000Z',
        step_type: 'SCRIPT', try_specifications: [{ mode: 'OPERATOR_STOP', catch_id: 'C1' }],
      }], connections: [],
    }];
    expect(validate(wf).valid).toBe(false);
  });

  test('isOperatorMode', () => {
    expect(isOperatorMode('OPERATOR_STOP')).toBe(true);
    expect(isOperatorMode('OPERATOR_ABORT')).toBe(true);
    expect(isOperatorMode('ERROR')).toBe(false);
  });
});
