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
//
// Spec 2026-09-04 §5.4.7: step-level action_property_bindings (non-GATE steps) get the same
// non-fatal resolution advisories the GATE bindings have — plus a GATE carrying step-level
// bindings is told they are ignored.
import { describe, expect, it } from 'vitest';
import { validate } from '../src/spec/validator.js';

const managed = (oid: string) => ({ local_id: oid, oid, version: '1.0.0', last_modified_date: '2026-01-01' });
const base = (steps: any[], connections: any[], extra: Record<string, unknown> = {}) => ({
  ...managed('wf'), schemaVersion: '5.0', steps, connections, ...extra,
});
const START = { ...managed('s'), step_type: 'START' };
const END = { ...managed('e'), step_type: 'END' };
const ENVS = { environment_specifications: [{ ...managed('env-1'), included_actions: [] }] };
const linear = (mid: any, extra: Record<string, unknown> = ENVS) => base(
  [START, mid, END],
  [{ from_step_id: 's', to_step_id: mid.oid }, { from_step_id: mid.oid, to_step_id: 'e' }],
  extra,
);
const codes = (r: ReturnType<typeof validate>) => (r.warnings ?? []).map(w => w.code);

describe('input-binding validation (spec 2026-09-04 §5.4.7)', () => {
  it('accepts a SCRIPT with a resolvable step-level binding — valid, no warnings', () => {
    const r = validate(linear({
      ...managed('sc'), step_type: 'SCRIPT',
      input_parameter_specifications: [{ id: 'level', default_value: 'Sensor.Value', value_type: 'property' }],
      action_property_bindings: [{ parameter_id: 'level', environment_oid: 'env-1', property: 'Sensor.Value' }],
    }));
    expect(r.valid).toBe(true);
    expect(codes(r)).toEqual([]);
  });

  it('warns INPUT_BINDING_UNKNOWN_ENVIRONMENT when neither oid nor name resolves', () => {
    const r = validate(linear({
      ...managed('sc'), step_type: 'SCRIPT',
      input_parameter_specifications: [{ id: 'level', default_value: 'Sensor.Value', value_type: 'property' }],
      action_property_bindings: [{ parameter_id: 'level', environment_oid: 'nope', environment_name: 'Nope', property: 'Sensor.Value' }],
    }));
    expect(r.valid).toBe(true);
    expect(codes(r)).toEqual(['INPUT_BINDING_UNKNOWN_ENVIRONMENT']);
    expect(r.warnings![0].message).toContain('input binding for parameter "level"');
  });

  it('resolves the environment by name when the oid is stale (no warning)', () => {
    const r = validate(linear({
      ...managed('sc'), step_type: 'SCRIPT',
      input_parameter_specifications: [{ id: 'level', default_value: 'Sensor.Value', value_type: 'property' }],
      action_property_bindings: [{ parameter_id: 'level', environment_oid: 'stale', environment_name: 'env-1', property: 'Sensor.Value' }],
    }));
    expect(codes(r)).toEqual([]);
  });

  it('warns INPUT_BINDING_UNKNOWN_PARAMETER when parameter_id matches no input', () => {
    const r = validate(linear({
      ...managed('sc'), step_type: 'SCRIPT',
      input_parameter_specifications: [{ id: 'level', default_value: '', value_type: 'literal' }],
      action_property_bindings: [{ parameter_id: 'temp', environment_oid: 'env-1', property: 'Sensor.Value' }],
    }));
    expect(codes(r)).toEqual(['INPUT_BINDING_UNKNOWN_PARAMETER']);
  });

  it('warns INPUT_BINDING_ON_GATE_IGNORED for a GATE carrying step-level bindings, and still checks its gate_config bindings', () => {
    const r = validate(linear({
      ...managed('g'), step_type: 'GATE',
      input_parameter_specifications: [{ id: 'f', default_value: 'Sensor.Value', value_type: 'property' }],
      action_property_bindings: [{ parameter_id: 'f', environment_oid: 'env-1', property: 'Sensor.Value' }],
      gate_config: { action_property_bindings: [{ parameter_id: 'f', environment_oid: 'nope', property: 'Sensor.Value' }] },
    }));
    expect(r.valid).toBe(true);
    expect(codes(r)).toEqual(['INPUT_BINDING_ON_GATE_IGNORED', 'GATE_BINDING_UNKNOWN_ENVIRONMENT']);
  });

  it('a GATE with only gate_config bindings still warns with the GATE codes (unchanged)', () => {
    const r = validate(linear({
      ...managed('g'), step_type: 'GATE',
      input_parameter_specifications: [{ id: 'f', default_value: '', value_type: 'literal' }],
      gate_config: { action_property_bindings: [{ parameter_id: 'other', environment_oid: 'env-1', property: 'Sensor.Value' }] },
    }));
    expect(codes(r)).toEqual(['GATE_BINDING_UNKNOWN_PARAMETER']);
  });
});
