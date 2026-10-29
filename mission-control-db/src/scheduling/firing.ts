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

import { and, eq, isNotNull, lte } from 'drizzle-orm';
import { schedule, scheduleRun } from '../db/schema/scheduling.js';
import { startInstance } from '../runtime/engine-harness.js';
import type { Schema } from '../db/client.js';
import type { PgDatabase } from 'drizzle-orm/pg-core';
type Db = PgDatabase<any, Schema>;

export async function fireDueTimeSchedules(db: Db, now: Date): Promise<{ fired: string[] }> {
  const due = await db.select().from(schedule)
    .where(and(eq(schedule.enabled, true), isNotNull(schedule.nextFireAt), lte(schedule.nextFireAt, now)));

  const fired: string[] = [];
  for (const s of due) {
    try {
      await db.transaction(async (tx) => {
        const { instanceId } = await startInstance(tx, { workflowId: s.workflowId, triggeredBy: 'schedule', scheduleId: s.id });
        await tx.insert(scheduleRun).values({ scheduleId: s.id, workflowInstanceId: instanceId, status: 'fired' });
        // one_time: disable after firing. recurring: nextFireAt is recomputed by the cron utility (Mission Management); cleared here.
        await tx.update(schedule).set({
          enabled: s.kind === 'one_time' ? false : s.enabled,
          nextFireAt: null, updatedAt: now,
        }).where(eq(schedule.id, s.id));
      });
      fired.push(s.id);
    } catch (err) {
      // Written on the outer db handle (not tx, which was rolled back) so a failed fire is still recorded.
      await db.insert(scheduleRun).values({ scheduleId: s.id, status: 'failed', detail: String(err) });
    }
  }
  return { fired };
}
