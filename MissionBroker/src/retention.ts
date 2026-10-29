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

import { sql } from 'drizzle-orm';
import type { Db } from './store.js';

export const RETENTION_BATCH_SIZE = 500;
export const RETENTION_INTERVAL_MS = 60 * 60 * 1000;

/** Deletes broker_action_instance rows whose calling runtime finished more than retentionDays ago,
 *  or whose caller is in neither workflow_instance nor runtime_history and whose own updated_at is
 *  that old. Batched; returns the total deleted. */
export async function purgeOldRecords(db: Db, now: Date, retentionDays: number, batchSize = RETENTION_BATCH_SIZE): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);
  let total = 0;
  for (;;) {
    const res = await db.execute(sql`DELETE FROM broker_action_instance WHERE id IN (
        SELECT b.id FROM broker_action_instance b
        LEFT JOIN runtime_history h ON h.workflow_instance_id = b.workflow_instance_id
        WHERE h.finished_at < ${cutoff}
           OR (h.id IS NULL AND b.updated_at < ${cutoff}
               AND NOT EXISTS (SELECT 1 FROM workflow_instance w WHERE w.id = b.workflow_instance_id))
        LIMIT ${batchSize})
      RETURNING id`);
    total += res.rows.length;
    if (res.rows.length < batchSize) return total;
  }
}
