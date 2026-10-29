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
// Repeating SCRIPT validation (spec 2026-10-13 §6.1).
import { describe, it, expect } from 'vitest';
import { validate } from '../src/spec/validator.js';

const managed = (oid: string) => ({ local_id: oid, oid, version: '1.0.0', last_modified_date: '2026-01-01' });
const withScript = (script_config: Record<string, unknown>) => ({
  ...managed('wf'), schemaVersion: '5.0',
  steps: [{ ...managed('s'), step_type: 'START' }, { ...managed('sc'), step_type: 'SCRIPT', script_config }, { ...managed('e'), step_type: 'END' }],
  connections: [{ from_step_id: 's', to_step_id: 'sc' }, { from_step_id: 'sc', to_step_id: 'e' }],
});

describe('repeating SCRIPT validation', () => {
  it('accepts a one-shot script and well-formed repeat configs', () => {
    expect(validate(withScript({ source: 'return true;' })).valid).toBe(true);
    expect(validate(withScript({ source: 'return true;', repeat: {} })).valid).toBe(true);
    expect(validate(withScript({ source: 'return true;', repeat: { cycle_seconds: 2.5, time_limit_seconds: 31_449_600, on_time_limit: 'complete' } })).valid).toBe(true);
  });

  it.each([
    [{ repeat: 'yes' }, 'INVALID_SCRIPT_REPEAT'],
    [{ repeat: [] }, 'INVALID_SCRIPT_REPEAT'],
    [{ repeat: { cycle_seconds: 0 } }, 'INVALID_SCRIPT_CYCLE'],
    [{ repeat: { cycle_seconds: '5' } }, 'INVALID_SCRIPT_CYCLE'],
    [{ repeat: { cycle_seconds: 31_449_601 } }, 'INVALID_SCRIPT_CYCLE'],
    [{ repeat: { cycle_seconds: 1e20 } }, 'INVALID_SCRIPT_CYCLE'],
    [{ repeat: { time_limit_seconds: 0 } }, 'INVALID_SCRIPT_TIME_LIMIT'],
    [{ repeat: { time_limit_seconds: 1.5 } }, 'INVALID_SCRIPT_TIME_LIMIT'],
    [{ repeat: { time_limit_seconds: 31_449_601 } }, 'INVALID_SCRIPT_TIME_LIMIT'],
    [{ repeat: { time_limit_seconds: 60, on_time_limit: 'retry' } }, 'INVALID_SCRIPT_TIME_LIMIT_ACTION'],
    [{ repeat: { on_time_limit: 'complete' } }, 'SCRIPT_TIME_LIMIT_ACTION_WITHOUT_LIMIT'],
  ])('rejects %j with %s', (script_config, code) => {
    const r = validate(withScript(script_config));
    expect(r.valid).toBe(false);
    expect(r.error_code).toBe(code);
    expect(r.error_message).toContain('(step sc)');
  });
});
