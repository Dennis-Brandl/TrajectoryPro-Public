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
import { describe, expect, it } from 'vitest';
import { validate } from '../src/spec/validator.js';

const managed = (oid: string) => ({ local_id: oid, oid, version: '1.0.0', last_modified_date: '2026-01-01' });
const START = { ...managed('s'), step_type: 'START' };
const END = { ...managed('e'), step_type: 'END' };
const wf = (servers: unknown[]) => ({
  ...managed('wf'), schemaVersion: '5.0',
  steps: [START, END],
  connections: [{ from_step_id: 's', to_step_id: 'e' }],
  environment_specifications: [{ ...managed('Line Env'), included_actions: [], action_server_specifications: servers.map((x) => ({ connection_type: 'REST', ...(x as object) })) }],
});

describe('action server URI validation', () => {
  it('blank, whitespace and missing action server URIs are valid', () => {
    expect(validate(wf([{ name: 'Main', uri: '' }])).valid).toBe(true);
    expect(validate(wf([{ name: 'Main', uri: '   ' }])).valid).toBe(true);
  });

  it('an ftp URI fails with the M1 message naming the environment and server', () => {
    const r = validate(wf([{ name: 'Main', uri: 'ftp://x' }]));
    expect(r.valid).toBe(false);
    expect(r.error_message).toBe(
      'Environment "Line Env" has an action server "Main" with an invalid URI "ftp://x". Fix it in Designer, then re-export and re-load the workflow.',
    );
  });
});
