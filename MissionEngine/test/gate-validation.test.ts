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
const base = (steps: any[], connections: any[], extra: Record<string, unknown> = {}) => ({
  ...managed('wf'), schemaVersion: '5.0', steps, connections, ...extra,
});
const START = { ...managed('s'), step_type: 'START' };
const END = { ...managed('e'), step_type: 'END' };

describe('GATE validation (spec 2026-08-29 §6.6)', () => {
  it('accepts a well-formed GATE with no gate_config (everything optional)', () => {
    const spec = base(
      [START, { ...managed('g'), step_type: 'GATE' }, END],
      [{ from_step_id: 's', to_step_id: 'g' }, { from_step_id: 'g', to_step_id: 'e' }],
    );
    expect(validate(spec).valid).toBe(true);
  });

  it('accepts a GATE with a fully-populated gate_config', () => {
    const spec = base(
      [START, {
        ...managed('g'), step_type: 'GATE',
        gate_config: {
          cycle_seconds: 2.5,
          language: 'javascript',
          source: 'return true;',
          action_property_bindings: [
            { parameter_id: 'temperature', environment_oid: 'env-1', environment_name: 'Reactor 1', property: 'Sensor.Value' },
          ],
        },
        input_parameter_specifications: [{ id: 'temperature', default_value: '0' }],
      }, END],
      [{ from_step_id: 's', to_step_id: 'g' }, { from_step_id: 'g', to_step_id: 'e' }],
      { environment_specifications: [{ ...managed('env-1'), included_actions: [] }] },
    );
    expect(validate(spec).valid).toBe(true);
  });

  it('rejects a GATE with 2 outgoing connections (GATE_WRONG_DEGREE)', () => {
    const spec = base(
      [START, { ...managed('g'), step_type: 'GATE' }, END, { ...managed('e2'), step_type: 'END' }],
      [{ from_step_id: 's', to_step_id: 'g' }, { from_step_id: 'g', to_step_id: 'e' }, { from_step_id: 'g', to_step_id: 'e2' }],
    );
    const r = validate(spec);
    expect(r.valid).toBe(false);
    expect(r.error_code).toBe('GATE_WRONG_DEGREE');
  });

  it('rejects a GATE with 2 incoming connections (GATE_WRONG_DEGREE)', () => {
    const spec = base(
      [START, { ...managed('x'), step_type: 'SCRIPT' }, { ...managed('g'), step_type: 'GATE' }, END],
      [{ from_step_id: 's', to_step_id: 'x' }, { from_step_id: 's', to_step_id: 'g' }, { from_step_id: 'x', to_step_id: 'g' }, { from_step_id: 'g', to_step_id: 'e' }],
    );
    const r = validate(spec);
    expect(r.valid).toBe(false);
    expect(r.error_code).toBe('GATE_WRONG_DEGREE');
  });

  it('rejects a GATE with 0 outgoing connections (GATE_WRONG_DEGREE)', () => {
    // A dangling GATE with no outgoing connection would also be ORPHANED for anything
    // downstream, but the GATE itself is still reachable from START, so semanticValidation
    // passes and gateValidation's own degree check is what fires.
    const spec = base(
      [START, { ...managed('g'), step_type: 'GATE' }, END],
      [{ from_step_id: 's', to_step_id: 'g' }, { from_step_id: 's', to_step_id: 'e' }],
    );
    const r = validate(spec);
    expect(r.valid).toBe(false);
    expect(r.error_code).toBe('GATE_WRONG_DEGREE');
  });

  it('rejects cycle_seconds < 1 (INVALID_GATE_CYCLE)', () => {
    const spec = base(
      [START, { ...managed('g'), step_type: 'GATE', gate_config: { cycle_seconds: 0.5 } }, END],
      [{ from_step_id: 's', to_step_id: 'g' }, { from_step_id: 'g', to_step_id: 'e' }],
    );
    const r = validate(spec);
    expect(r.valid).toBe(false);
    expect(r.error_code).toBe('INVALID_GATE_CYCLE');
  });

  it('rejects a non-numeric cycle_seconds (INVALID_GATE_CYCLE)', () => {
    const spec = base(
      [START, { ...managed('g'), step_type: 'GATE', gate_config: { cycle_seconds: 'soon' } }, END],
      [{ from_step_id: 's', to_step_id: 'g' }, { from_step_id: 'g', to_step_id: 'e' }],
    );
    const r = validate(spec);
    expect(r.valid).toBe(false);
    expect(r.error_code).toBe('INVALID_GATE_CYCLE');
  });

  it('rejects cycle_seconds above 31449600 (INVALID_GATE_CYCLE)', () => {
    for (const cycle_seconds of [31_449_601, 1e20]) {
      const spec = base(
        [START, { ...managed('g'), step_type: 'GATE', gate_config: { cycle_seconds } }, END],
        [{ from_step_id: 's', to_step_id: 'g' }, { from_step_id: 'g', to_step_id: 'e' }],
      );
      const r = validate(spec);
      expect(r.valid).toBe(false);
      expect(r.error_code).toBe('INVALID_GATE_CYCLE');
      expect(r.error_message).toContain('from 1 to 31449600');
    }
  });

  it('accepts cycle_seconds exactly 1 (boundary)', () => {
    const spec = base(
      [START, { ...managed('g'), step_type: 'GATE', gate_config: { cycle_seconds: 1 } }, END],
      [{ from_step_id: 's', to_step_id: 'g' }, { from_step_id: 'g', to_step_id: 'e' }],
    );
    expect(validate(spec).valid).toBe(true);
  });

  it('accepts try_specifications on a GATE (TRY-capable)', () => {
    const spec = base(
      [START,
       { ...managed('g'), step_type: 'GATE', try_specifications: [{ mode: 'ERROR', catch_id: 'c1' }] },
       { ...managed('c'), step_type: 'CATCH', catch_id: 'c1' },
       { ...managed('r'), step_type: 'RETURN', return_config: { command: 'ABANDON' } },
       END],
      [{ from_step_id: 's', to_step_id: 'g' }, { from_step_id: 'g', to_step_id: 'e' }, { from_step_id: 'c', to_step_id: 'r' }],
    );
    expect(validate(spec).valid).toBe(true);
  });

  it('warns (does not fail) when a binding references an unresolvable environment', () => {
    const spec = base(
      [START, {
        ...managed('g'), step_type: 'GATE',
        gate_config: {
          action_property_bindings: [
            { parameter_id: 'temperature', environment_oid: 'no-such-env', environment_name: 'Nope', property: 'Sensor.Value' },
          ],
        },
        input_parameter_specifications: [{ id: 'temperature', default_value: '0' }],
      }, END],
      [{ from_step_id: 's', to_step_id: 'g' }, { from_step_id: 'g', to_step_id: 'e' }],
    );
    const r = validate(spec);
    expect(r.valid).toBe(true);
    expect(r.warnings?.some(w => w.message.includes('environment'))).toBe(true);
  });

  it('rejects a GATE declaring resource_command_specifications (GATE_RESOURCES_UNSUPPORTED)', () => {
    const spec = base(
      [START, {
        ...managed('g'), step_type: 'GATE',
        resource_command_specifications: [{ command_type: 'Acquire', resource_name: 'Lock' }],
      }, END],
      [{ from_step_id: 's', to_step_id: 'g' }, { from_step_id: 'g', to_step_id: 'e' }],
    );
    const r = validate(spec);
    expect(r.valid).toBe(false);
    expect(r.error_code).toBe('GATE_RESOURCES_UNSUPPORTED');
  });

  it('warns (does not fail) when a binding parameter_id matches no input parameter', () => {
    const spec = base(
      [START, {
        ...managed('g'), step_type: 'GATE',
        gate_config: {
          action_property_bindings: [
            { parameter_id: 'unbound_param', environment_oid: 'env-1', property: 'Sensor.Value' },
          ],
        },
        // Deliberately no input_parameter_specifications entry named 'unbound_param'.
      }, END],
      [{ from_step_id: 's', to_step_id: 'g' }, { from_step_id: 'g', to_step_id: 'e' }],
      { environment_specifications: [{ ...managed('env-1'), included_actions: [] }] },
    );
    const r = validate(spec);
    expect(r.valid).toBe(true);
    expect(r.warnings?.some(w => w.message.includes('unbound_param'))).toBe(true);
  });
});

describe('timed GATE validation (spec 2026-10-13 §3.2)', () => {
  const withGate = (gate_config: Record<string, unknown>) => base(
    [START, { ...managed('g'), step_type: 'GATE', gate_config }, END],
    [{ from_step_id: 's', to_step_id: 'g' }, { from_step_id: 'g', to_step_id: 'e' }],
  );

  it('accepts timer and condition_or_timer with a whole-second delay', () => {
    expect(validate(withGate({ mode: 'timer', delay_seconds: 240 })).valid).toBe(true);
    expect(validate(withGate({ mode: 'condition_or_timer', delay_seconds: 31_449_600, source: 'return false;' })).valid).toBe(true);
    expect(validate(withGate({ mode: 'condition' })).valid).toBe(true);
  });

  it.each([
    [{ mode: 'sometimes' }, 'INVALID_GATE_MODE'],
    [{ mode: 'timer' }, 'GATE_DELAY_REQUIRED'],
    [{ mode: 'condition_or_timer' }, 'GATE_DELAY_REQUIRED'],
    [{ delay_seconds: 60 }, 'GATE_DELAY_WITHOUT_TIMER'],
    [{ mode: 'condition', delay_seconds: 60 }, 'GATE_DELAY_WITHOUT_TIMER'],
    [{ mode: 'timer', delay_seconds: 0 }, 'INVALID_GATE_DELAY'],
    [{ mode: 'timer', delay_seconds: 1.5 }, 'INVALID_GATE_DELAY'],
    [{ mode: 'timer', delay_seconds: 31_449_601 }, 'INVALID_GATE_DELAY'],
    [{ mode: 'timer', delay_seconds: '60' }, 'INVALID_GATE_DELAY'],
  ])('rejects %j with %s', (gate_config, code) => {
    const r = validate(withGate(gate_config));
    expect(r.valid).toBe(false);
    expect(r.error_code).toBe(code);
    expect(r.error_message).toContain('(step g)');
  });
});
