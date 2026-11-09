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

// Runs the schedule tick (spec 2026-11-08 §6.1). Like the sweep it has its own timer and is not a
// unit of the work loop, so a slow schedule cannot starve steps. The work is in mission-control-db.

import { runScheduleTick } from 'mission-control-db/src/scheduling/tick';
import type { EngineDeps } from './config.js';
import type { Db } from './db.js';
import { logCycleErrorOnce } from './loop.js';

/** Start the schedule timer, unless SCHEDULER_ENABLED turned it off. Skips a tick while the previous
 *  one is still running, logs a failing tick once per distinct message, and returns a function that
 *  stops the timer. */
export function startScheduleTimer(db: Db, deps: EngineDeps): () => void {
  if (!deps.config.schedulerEnabled) {
    console.log('[mission-engine] scheduler disabled (SCHEDULER_ENABLED=false) — no schedule starts anything');
    return () => {};
  }
  let running = false;
  const tick = (): void => {
    if (running) return;
    running = true;
    runScheduleTick(db, deps.now())
      .catch((err) => logCycleErrorOnce(err, deps.now, 'schedule tick'))
      .finally(() => { running = false; });
  };
  const timer = setInterval(tick, deps.config.scheduleTickMs);
  timer.unref();
  return () => clearInterval(timer);
}
