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
// Timed GATE (spec 2026-10-13 §3): the pure timing rules shared by activation and evaluation.
import { describe, expect, it } from 'vitest';
import {
  gateMode, gateDeadline, gateExpired, nextGateWake, gateUsesBindings, formatDuration,
} from '../src/core/step-handlers.js';

const gate = (gate_config: Record<string, unknown>) =>
  ({ oid: 'g', local_id: 'g', step_type: 'GATE', version: '1.0.0', last_modified_date: '2026-01-01', gate_config }) as any;
const T0 = new Date('2026-01-01T00:00:00.000Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);

describe('gate timing helpers', () => {
  it('mode defaults to condition and ignores unknown values', () => {
    expect(gateMode(gate({}))).toBe('condition');
    expect(gateMode(gate({ mode: 'bogus' }))).toBe('condition');
    expect(gateMode(gate({ mode: 'timer' }))).toBe('timer');
    expect(gateMode(gate({ mode: 'condition_or_timer' }))).toBe('condition_or_timer');
  });

  it('deadline = startedAt + delay, for timed modes only', () => {
    expect(gateDeadline(gate({ mode: 'timer', delay_seconds: 240 }), T0)).toEqual(at(240));
    expect(gateDeadline(gate({ mode: 'condition_or_timer', delay_seconds: 7 }), T0)).toEqual(at(7));
    expect(gateDeadline(gate({ delay_seconds: 240 }), T0)).toBeNull();
    expect(gateDeadline(gate({ mode: 'timer', delay_seconds: 240 }), null)).toBeNull();
  });

  it('expired: at or after the deadline; never for a condition gate', () => {
    const g = gate({ mode: 'timer', delay_seconds: 240 });
    expect(gateExpired(g, at(239), T0)).toBe(false);
    expect(gateExpired(g, at(240), T0)).toBe(true);
    expect(gateExpired(gate({ cycle_seconds: 1 }), at(10_000), T0)).toBe(false);
    // A timed gate with no computable deadline counts as expired (never a wake-now loop).
    expect(gateExpired(gate({ mode: 'timer' }), T0, T0)).toBe(true);
  });

  it('next wake: timer → deadline; condition_or_timer → min(cycle, deadline); condition → cycle', () => {
    expect(nextGateWake(gate({ mode: 'timer', delay_seconds: 240 }), at(10), T0)).toEqual(at(240));
    const cot = gate({ mode: 'condition_or_timer', delay_seconds: 7, cycle_seconds: 5 });
    expect(nextGateWake(cot, T0, T0)).toEqual(at(5));
    expect(nextGateWake(cot, at(5), T0)).toEqual(at(7));
    expect(nextGateWake(gate({ cycle_seconds: 2 }), T0, T0)).toEqual(at(2));
  });

  it('a timer gate never uses its bindings', () => {
    const bindings = [{ parameter_id: 'p', property: 'P.V' }];
    expect(gateUsesBindings(gate({ action_property_bindings: bindings }))).toBe(true);
    expect(gateUsesBindings(gate({ mode: 'condition_or_timer', delay_seconds: 9, action_property_bindings: bindings }))).toBe(true);
    expect(gateUsesBindings(gate({ mode: 'timer', delay_seconds: 9, action_property_bindings: bindings }))).toBe(false);
    expect(gateUsesBindings(gate({}))).toBe(false);
  });

  it('formatDuration names every non-zero unit', () => {
    expect(formatDuration(7820)).toBe('2 h 10 min 20 s');
    expect(formatDuration(240)).toBe('4 min');
    expect(formatDuration(0)).toBe('0 s');
    expect(formatDuration(694_861)).toBe('1 wk 1 d 1 h 1 min 1 s');
  });
});
