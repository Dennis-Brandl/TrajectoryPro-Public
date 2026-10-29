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
import { reconcileAssignments } from 'mission-control-db/src/runtime/assignments';
import type { Db } from '../db.js';
import type { EngineDeps } from '../config.js';

export const OPERATOR_CHANGE_CHANNEL = 'operator_change';

/** Run at the TAIL of every transaction that claims an instance row (loop.ts LOCKING
 *  PROTOCOL): closes/creates offers from ground truth, then NOTIFYs the operator channel
 *  (payload = work_center_id) so SSE sessions refresh. NOTIFY fires on commit — a rollback
 *  drops it, which is exactly right. */
export async function reconcileAndNotify(tx: Db, instanceId: string, deps: EngineDeps): Promise<void> {
  const result = await reconcileAssignments(tx, instanceId, deps.now);
  if (result?.changed) {
    await tx.execute(sql`SELECT pg_notify(${OPERATOR_CHANGE_CHANNEL}, ${result.workCenterId})`);
  }
}

/** NOTIFY the operator channel for one work center without reconciling assignments — for
 *  changes the inbox shows that are not assignments (spec 2026-10-13 §5.3: Pilot's Waiting
 *  list of timed gates). Fires on commit, like reconcileAndNotify's own NOTIFY. */
export async function notifyWorkCenter(tx: Db, workCenterId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_notify(${OPERATOR_CHANGE_CHANNEL}, ${workCenterId})`);
}
