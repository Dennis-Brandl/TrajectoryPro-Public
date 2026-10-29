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

import { and, eq } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import * as schema from 'mission-control-db/src/db/schema/index';
import { brokerActionInstance, type BrokerActionInstance } from 'mission-control-db/src/db/schema/index';
import type { Param } from './wire.js';

export type Db = PgDatabase<any, typeof schema>;

/** One row per step activation: on a conflict with an existing (step_instance_id, step_started_at)
 *  row nothing is written and null is returned, so the caller re-selects the winner. */
export async function insertInstance(db: Db, row: {
  actionKey: string; workflowInstanceId: string; stepInstanceId: string; stepStartedAt: Date;
  targetInstanceId?: string | null; state: 'RUNNING' | 'COMPLETED'; outputs: Param[];
}): Promise<BrokerActionInstance | null> {
  const [r] = await db.insert(brokerActionInstance).values({
    actionKey: row.actionKey, workflowInstanceId: row.workflowInstanceId, stepInstanceId: row.stepInstanceId,
    stepStartedAt: row.stepStartedAt, targetInstanceId: row.targetInstanceId ?? null, state: row.state, outputs: row.outputs,
  }).onConflictDoNothing().returning();
  return r ?? null;
}

/** The row an earlier invoke of this step activation wrote, if any. */
export async function findByActivation(db: Db, stepInstanceId: string, stepStartedAt: Date): Promise<BrokerActionInstance | null> {
  const [r] = await db.select().from(brokerActionInstance)
    .where(and(eq(brokerActionInstance.stepInstanceId, stepInstanceId), eq(brokerActionInstance.stepStartedAt, stepStartedAt)));
  return r ?? null;
}

export async function getInstance(db: Db, id: string): Promise<BrokerActionInstance | null> {
  const [r] = await db.select().from(brokerActionInstance).where(eq(brokerActionInstance.id, id));
  return r ?? null;
}

/** RUNNING -> COMPLETED/ABORTED exactly once (a wake and the poll may race). */
export async function finishInstance(db: Db, id: string, state: 'COMPLETED' | 'ABORTED', outputs: Param[]): Promise<boolean> {
  const res = await db.update(brokerActionInstance).set({ state, outputs, updatedAt: new Date() })
    .where(and(eq(brokerActionInstance.id, id), eq(brokerActionInstance.state, 'RUNNING')))
    .returning({ id: brokerActionInstance.id });
  return res.length > 0;
}

export async function deleteInstance(db: Db, id: string): Promise<boolean> {
  const res = await db.delete(brokerActionInstance).where(eq(brokerActionInstance.id, id)).returning({ id: brokerActionInstance.id });
  return res.length > 0;
}

export function runningWaits(db: Db): Promise<BrokerActionInstance[]> {
  return db.select().from(brokerActionInstance)
    .where(and(eq(brokerActionInstance.state, 'RUNNING'), eq(brokerActionInstance.actionKey, 'wait')));
}
