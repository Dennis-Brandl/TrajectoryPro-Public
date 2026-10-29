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

// Timed GATE / repeating SCRIPT countdown copy (spec 2026-10-13 §5.2/§5.4/§6.7). Mirrors the Pilot's inbox/gate-timer-text.ts.
import type { GateTimer } from '@/lib/api/types';

const UNITS: Array<[string, number]> = [['wk', 604_800], ['d', 86_400], ['h', 3_600], ['min', 60], ['s', 1]];

/** The two largest units, zero units dropped: "1 h 52 min", "2 h", "2 d 3 h", "45 s". */
export function coarseDuration(totalSeconds: number): string {
  let rest = Math.max(0, Math.floor(totalSeconds));
  const parts: Array<[number, string]> = [];
  for (const [unit, size] of UNITS) {
    const n = Math.floor(rest / size);
    rest -= n * size;
    if (parts.length > 0 || n > 0) parts.push([n, unit]);
    if (parts.length === 2) break;
  }
  const shown = parts.filter(([n]) => n > 0).map(([n, unit]) => `${n} ${unit}`);
  return shown.length > 0 ? shown.join(' ') : '0 s';
}

function countdown(remainingSeconds: number): string {
  if (remainingSeconds < 3600) {
    const m = Math.floor(remainingSeconds / 60);
    const s = remainingSeconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  return coarseDuration(remainingSeconds);
}

export function gateTimerText(timer: GateTimer, nowMs: number): string {
  if (timer.mode === 'repeat_script') {
    const running = `Running script · checks every ${timer.cycleSeconds} s`;
    if (timer.deadline === null) return running;
    const left = Math.ceil((Date.parse(timer.deadline) - nowMs) / 1000);
    return left <= 0 ? `${running} · time limit reached` : `${running} · time limit in ${countdown(left)}`;
  }
  const remaining = Math.ceil((Date.parse(timer.deadline) - nowMs) / 1000);
  const opens = remaining <= 0 ? 'Opening…' : `Opens in ${countdown(remaining)}`;
  return timer.mode === 'condition_or_timer' && timer.cycleSeconds !== null
    ? `${opens} · checking every ${timer.cycleSeconds} s`
    : opens;
}

/** Commander's tooltip line: the countdown plus the local time it ends at — with the date
 *  when that is not today, so a multi-day gate's "14:32" can't be read as this afternoon.
 *  A repeating script with no time limit has no end time to show. */
export function gateTimerLine(timer: GateTimer, nowMs: number): string {
  if (timer.deadline === null) return gateTimerText(timer, nowMs);
  const deadline = new Date(timer.deadline);
  const time = deadline.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const at = deadline.toDateString() === new Date(nowMs).toDateString()
    ? time
    : `${deadline.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
  return `${gateTimerText(timer, nowMs)} (at ${at})`;
}
