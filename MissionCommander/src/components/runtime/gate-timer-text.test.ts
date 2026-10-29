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
import { coarseDuration, gateTimerText, gateTimerLine } from './gate-timer-text';

const T0 = Date.parse('2026-01-01T10:00:00.000Z');
const iso = (s: number) => new Date(T0 + s * 1000).toISOString();

describe('gate timer text', () => {
  it('coarse duration keeps the two largest units', () => {
    expect(coarseDuration(6720)).toBe('1 h 52 min');
    expect(coarseDuration(7200)).toBe('2 h');
    expect(coarseDuration(183_600)).toBe('2 d 3 h');
    expect(coarseDuration(45)).toBe('45 s');
  });
  it('counts down m:ss under an hour, coarse above, and says Opening… at zero', () => {
    expect(gateTimerText({ mode: 'timer', deadline: iso(192), cycleSeconds: null }, T0)).toBe('Opens in 3:12');
    expect(gateTimerText({ mode: 'timer', deadline: iso(6720), cycleSeconds: null }, T0)).toBe('Opens in 1 h 52 min');
    expect(gateTimerText({ mode: 'timer', deadline: iso(-1), cycleSeconds: null }, T0)).toBe('Opening…');
    expect(gateTimerText({ mode: 'condition_or_timer', deadline: iso(60), cycleSeconds: 5 }, T0)).toBe('Opens in 1:00 · checking every 5 s');
  });
  it('the Commander line adds the clock time it opens at', () => {
    expect(gateTimerLine({ mode: 'timer', deadline: iso(6720), cycleSeconds: null }, T0)).toMatch(/^Opens in 1 h 52 min \(at .+\)$/);
  });
  it('names the date only when the gate opens on another day', () => {
    const soon = gateTimerLine({ mode: 'timer', deadline: iso(60), cycleSeconds: null }, T0);
    const day = (s: number) => new Date(T0 + s * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' });
    expect(soon).not.toContain(day(60));
    const later = gateTimerLine({ mode: 'timer', deadline: iso(3 * 86_400), cycleSeconds: null }, T0);
    expect(later).toMatch(/^Opens in 3 d \(at .+\)$/);
    expect(later).toContain(day(3 * 86_400));
  });
  it('a repeating script says it is running, its cycle, and its time limit if it has one', () => {
    expect(gateTimerText({ mode: 'repeat_script', deadline: null, cycleSeconds: 5 }, T0)).toBe('Running script · checks every 5 s');
    expect(gateTimerText({ mode: 'repeat_script', deadline: iso(4320), cycleSeconds: 5 }, T0)).toBe('Running script · checks every 5 s · time limit in 1 h 12 min');
    expect(gateTimerText({ mode: 'repeat_script', deadline: iso(-1), cycleSeconds: 5 }, T0)).toBe('Running script · checks every 5 s · time limit reached');
    expect(gateTimerLine({ mode: 'repeat_script', deadline: null, cycleSeconds: 5 }, T0)).toBe('Running script · checks every 5 s');
    expect(gateTimerLine({ mode: 'repeat_script', deadline: iso(60), cycleSeconds: 5 }, T0)).toMatch(/^Running script · checks every 5 s · time limit in 1:00 \(at .+\)$/);
  });
});
