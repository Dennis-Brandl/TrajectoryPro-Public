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

// Append-only audit log for Master and Runtime Schedules (spec 2026-11-08 §5.5).

import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { Schema } from '../db/client.js';
import { runtimeScheduleEvent } from '../db/schema/index.js';

type Db = PgDatabase<any, Schema>;

export type ScheduleActor =
  | { kind: 'user'; userId: string; name: string }
  | { kind: 'api_client'; clientId: string; name: string }
  | { kind: 'system' };

export async function appendScheduleEvent(
  tx: Db,
  row: { runtimeScheduleId: string | null; masterScheduleId?: string; action: string; actor: ScheduleActor; detail?: unknown },
): Promise<void> {
  const { actor } = row;
  await tx.insert(runtimeScheduleEvent).values({
    actorKind: actor.kind,
    actorId: actor.kind === 'user' ? actor.userId : actor.kind === 'api_client' ? actor.clientId : null,
    actorName: actor.kind === 'system' ? null : actor.name,
    action: row.action,
    detail: row.detail ?? null,
    masterScheduleId: row.masterScheduleId ?? null,
    runtimeScheduleId: row.runtimeScheduleId,
  });
}
