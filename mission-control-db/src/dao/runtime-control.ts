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
import { workflowInstance } from '../db/schema/index.js';
import { DaoError } from './errors.js';
import type { Schema } from '../db/client.js';

type Db = PgDatabase<any, Schema>;

async function requestTransition(db: Db, instanceId: string, from: readonly string[], to: string, verb: string): Promise<void> {
  const res = await db.update(workflowInstance)
    .set({ status: to, updatedAt: new Date() })
    .where(and(eq(workflowInstance.id, instanceId), inArray(workflowInstance.status, [...from])))
    .returning({ id: workflowInstance.id });
  if (res.length > 0) return;
  const row = await db.select({ status: workflowInstance.status }).from(workflowInstance).where(eq(workflowInstance.id, instanceId));
  if (row.length === 0) throw new DaoError('RUNTIME_NOT_FOUND');
  throw new DaoError('RUNTIME_INVALID_STATE', `cannot ${verb} from ${row[0].status}`);
}

export const requestPause = (db: Db, id: string) => requestTransition(db, id, ['running'], 'pausing', 'pause');
export const requestResume = (db: Db, id: string) => requestTransition(db, id, ['paused'], 'resuming', 'resume');
export const requestStop = (db: Db, id: string) => requestTransition(db, id, ['running', 'paused', 'pausing'], 'stopping', 'stop');
export const requestAbort = (db: Db, id: string) => requestTransition(db, id, ['queued', 'running', 'pausing', 'paused', 'resuming', 'stopping'], 'aborting', 'abort');
