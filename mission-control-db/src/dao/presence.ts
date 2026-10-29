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

import { and, eq, inArray } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { appUser, operatorPresence } from '../db/schema/index.js';
import type { Schema } from '../db/client.js';

type Db = PgDatabase<any, Schema>;

export type WorkCenterPresenceEntry = { userId: string; name: string | null; status: 'online' | 'away'; since: Date };

/** Presence strip (spec §4): who is attending this work center right now. `offline` rows are
 *  excluded — the sweep that ages heartbeats out is the engine's concern, not this read's. */
export async function listWorkCenterPresence(db: Db, workCenterId: string): Promise<WorkCenterPresenceEntry[]> {
  const rows = await db.select({
    userId: operatorPresence.userId, name: appUser.displayName,
    status: operatorPresence.status, since: operatorPresence.lastHeartbeatAt,
  }).from(operatorPresence)
    .innerJoin(appUser, eq(appUser.id, operatorPresence.userId))
    .where(and(
      eq(operatorPresence.attendingWorkCenterId, workCenterId),
      inArray(operatorPresence.status, ['online', 'away']),
    ));
  return rows.map((r) => ({ ...r, status: r.status as 'online' | 'away' }))
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
}
