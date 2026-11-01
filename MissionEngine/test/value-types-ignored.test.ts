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

const workflow = (env: Record<string, unknown>) => ({
  ...managed('wf'),
  schemaVersion: '5.0',
  steps: [
    { ...managed('s'), step_type: 'START' },
    { ...managed('e'), step_type: 'END' },
  ],
  connections: [{ from_step_id: 's', to_step_id: 'e' }],
  environment_specifications: [{ ...managed('env-1'), included_actions: [], ...env }],
});

// Commander can write a package's environments/ copy, Value Types included, into the workflow it
// runs (propagateEnvironmentToWorkflows), so the engine has to accept them there.
describe('Value Types in an embedded environment', () => {
  it('validates the same with and without them', () => {
    const plain = validate(workflow({}));
    const withValueTypes = validate(
      workflow({
        value_type_specifications: [{ name: 'Order', oid: 'vt-1', entries: [{ name: 'Size', value: 'Large' }] }],
      }),
    );
    expect(plain.valid).toBe(true);
    expect(withValueTypes).toEqual(plain);
  });
});
