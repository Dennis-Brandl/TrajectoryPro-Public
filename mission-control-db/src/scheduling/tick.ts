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

// One schedule tick (spec 2026-11-08 §6.1): process ended runs, carry out Resume decisions, then
// fire due slots, in that order, and then the housekeeping that follows from them, last of all
// writing each pass that has completed to schedule history.

import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { Schema } from '../db/client.js';
import { runCatchup } from './catchup.js';
import { finishCompletedSchedules, markLostRuns, processEndedRuns } from './chain.js';
import { fireDueSlots } from './fire.js';
import { recordFinishedPasses } from './history.js';

type Db = PgDatabase<any, Schema>;

const LOST_SCAN_EVERY_MS = 60_000;
let lastLostScanAt = Number.NEGATIVE_INFINITY;

/** Once a minute at most (§6.3). A clock that moved backwards scans now rather than waiting it out. */
async function scanForLostRuns(db: Db, now: Date): Promise<number> {
  const sinceLast = now.getTime() - lastLostScanAt;
  if (sinceLast >= 0 && sinceLast < LOST_SCAN_EVERY_MS) return 0;
  lastLostScanAt = now.getTime();
  return markLostRuns(db, now);
}

export async function runScheduleTick(db: Db, now: Date): Promise<{
  chains: number; catchup: number; fired: number; lost: number; finished: number; recorded: number;
}> {
  const chains = await processEndedRuns(db, now);
  const catchup = await runCatchup(db, now);
  const fired = await fireDueSlots(db, now);
  const lost = await scanForLostRuns(db, now);
  const finished = await finishCompletedSchedules(db, now);
  const recorded = await recordFinishedPasses(db, now);
  return { chains, catchup, fired, lost, finished, recorded };
}
