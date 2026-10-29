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

// Timed GATE and repeating SCRIPT projection (spec 2026-10-13 §5.4, §6.7): what the Pilot and the
// Commander count down against. Computed from the frozen recipe and the row's started_at — the
// same rules the engine schedules by (MissionEngine step-handlers.ts gateDeadline /
// scriptLimitDeadline).

export type GateTimerMode = 'timer' | 'condition_or_timer' | 'repeat_script';
export type GateTimer =
  | {
      mode: 'timer' | 'condition_or_timer';
      /** ISO instant the gate opens by. */
      deadline: string;
      /** condition_or_timer: how often the script is checked; null for a pure timer. */
      cycleSeconds: number | null;
    }
  | {
      /** A waiting repeating SCRIPT. */
      mode: 'repeat_script';
      /** ISO instant its time limit runs out; null = no time limit. */
      deadline: string | null;
      /** How often it runs. */
      cycleSeconds: number;
    };

const DEFAULT_CYCLE_SECONDS = 5;
const cycleOf = (raw: unknown): number => (typeof raw === 'number' && raw >= 1 ? raw : DEFAULT_CYCLE_SECONDS);

/** `armed` is the gate's engine_state.armedGates entry: once an armed gate has opened it is only
 *  waiting for its controlled action to stop — no countdown, and nothing left to continue. */
export function gateTimerOf(
  def: Record<string, unknown> | null, startedAt: Date | null, armed?: { open?: boolean } | null,
): GateTimer | null {
  if (armed?.open) return null;
  const gc = (def?.gate_config ?? null) as Record<string, unknown> | null;
  const mode = gc?.mode;
  if (mode !== 'timer' && mode !== 'condition_or_timer') return null;
  const delay = gc?.delay_seconds;
  if (typeof delay !== 'number' || !startedAt) return null;
  return {
    mode,
    deadline: new Date(startedAt.getTime() + delay * 1000).toISOString(),
    cycleSeconds: mode === 'timer' ? null : cycleOf(gc?.cycle_seconds),
  };
}

/** A repeating SCRIPT's projection; null for a one-shot script. */
export function scriptTimerOf(def: Record<string, unknown> | null, startedAt: Date | null): GateTimer | null {
  const sc = (def?.script_config ?? null) as Record<string, unknown> | null;
  const repeat = sc?.repeat;
  if (!repeat || typeof repeat !== 'object' || Array.isArray(repeat) || !startedAt) return null;
  const r = repeat as Record<string, unknown>;
  const limit = r.time_limit_seconds;
  return {
    mode: 'repeat_script',
    deadline: typeof limit === 'number' ? new Date(startedAt.getTime() + limit * 1000).toISOString() : null,
    cycleSeconds: cycleOf(r.cycle_seconds),
  };
}

/** The countdown for a step in this state: a waiting timed gate or a waiting repeating script. */
export function waitTimerOf(
  state: string, def: Record<string, unknown> | null, startedAt: Date | null, armed?: { open?: boolean } | null,
): GateTimer | null {
  if (state === 'WAITING_GATE') return gateTimerOf(def, startedAt, armed);
  if (state === 'WAITING_SCRIPT') return scriptTimerOf(def, startedAt);
  return null;
}
