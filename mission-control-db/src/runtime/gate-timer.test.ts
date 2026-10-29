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

import { describe, it, expect } from 'vitest';
import { gateTimerOf, scriptTimerOf, waitTimerOf } from './gate-timer.js';

const T0 = new Date('2026-01-01T00:00:00.000Z');

describe('gateTimerOf', () => {
  it('projects a timer gate: deadline = started + delay, no cycle', () => {
    expect(gateTimerOf({ gate_config: { mode: 'timer', delay_seconds: 240 } }, T0))
      .toEqual({ mode: 'timer', deadline: '2026-01-01T00:04:00.000Z', cycleSeconds: null });
  });
  it('projects condition_or_timer with its cycle (default 5)', () => {
    expect(gateTimerOf({ gate_config: { mode: 'condition_or_timer', delay_seconds: 60, cycle_seconds: 2 } }, T0))
      .toEqual({ mode: 'condition_or_timer', deadline: '2026-01-01T00:01:00.000Z', cycleSeconds: 2 });
    expect(gateTimerOf({ gate_config: { mode: 'condition_or_timer', delay_seconds: 60 } }, T0)?.cycleSeconds).toBe(5);
  });
  it('is null for condition gates, missing delay, missing start, missing def', () => {
    expect(gateTimerOf({ gate_config: { cycle_seconds: 5 } }, T0)).toBeNull();
    expect(gateTimerOf({ gate_config: { mode: 'timer' } }, T0)).toBeNull();
    expect(gateTimerOf({ gate_config: { mode: 'timer', delay_seconds: 9 } }, null)).toBeNull();
    expect(gateTimerOf(null, T0)).toBeNull();
  });
  it('is null once an armed gate has opened (it only waits for its action to stop)', () => {
    const def = { gate_config: { mode: 'timer', delay_seconds: 60 } };
    expect(gateTimerOf(def, T0, { open: true })).toBeNull();
    expect(gateTimerOf(def, T0, { open: false })?.mode).toBe('timer');
    expect(gateTimerOf(def, T0, null)?.mode).toBe('timer');
  });
});

describe('scriptTimerOf / waitTimerOf (spec 2026-10-13 §6.7)', () => {
  it('projects a repeating script: cycle (default 5) and the time limit as deadline, or none', () => {
    expect(scriptTimerOf({ script_config: { repeat: { cycle_seconds: 2, time_limit_seconds: 60 } } }, T0))
      .toEqual({ mode: 'repeat_script', deadline: '2026-01-01T00:01:00.000Z', cycleSeconds: 2 });
    expect(scriptTimerOf({ script_config: { repeat: {} } }, T0))
      .toEqual({ mode: 'repeat_script', deadline: null, cycleSeconds: 5 });
  });
  it('is null for a one-shot script, a missing start or a missing def', () => {
    expect(scriptTimerOf({ script_config: { source: 'return true;' } }, T0)).toBeNull();
    expect(scriptTimerOf({ script_config: { repeat: {} } }, null)).toBeNull();
    expect(scriptTimerOf(null, T0)).toBeNull();
  });
  it('dispatches on the step state', () => {
    const gate = { gate_config: { mode: 'timer', delay_seconds: 60 } };
    const script = { script_config: { repeat: {} } };
    expect(waitTimerOf('WAITING_GATE', gate, T0)?.mode).toBe('timer');
    expect(waitTimerOf('WAITING_SCRIPT', script, T0)?.mode).toBe('repeat_script');
    expect(waitTimerOf('WAITING_GATE', gate, T0, { open: true })).toBeNull();
    expect(waitTimerOf('COMPLETED', script, T0)).toBeNull();
  });
});
