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

import { pgTable, uuid, text, jsonb, timestamp, index, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** Spec 2026-10-15 §3 Design 2 / §6.1: one row per action instance the Distributed Workflow
 *  Management Service accepted, so a service restart never loses one (the engine answers a 404 on
 *  GET with "Instance lost on server"). Soft links only, like runtime_history: the calling
 *  runtime is swept on its own clock. */
export const BROKER_INSTANCE_STATES = ['RUNNING', 'COMPLETED', 'ABORTED'] as const;
export type BrokerInstanceState = (typeof BROKER_INSTANCE_STATES)[number];

export const brokerActionInstance = pgTable('broker_action_instance', {
  id: uuid('id').primaryKey().defaultRandom(),
  actionKey: text('action_key').notNull(),
  workflowInstanceId: uuid('workflow_instance_id').notNull(),
  stepInstanceId: uuid('step_instance_id').notNull(),
  /** The calling step's activation (step_instance.started_at at invoke). With step_instance_id it
   *  makes an invoke once per activation: a repeated POST returns this row. Null on rows from
   *  before migration 0043. */
  stepStartedAt: timestamp('step_started_at', { withTimezone: true }),
  targetInstanceId: uuid('target_instance_id'),
  state: text('state').notNull().default('RUNNING'),
  outputs: jsonb('outputs').notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('broker_action_instance_running_idx').on(t.state).where(sql`${t.state} = 'RUNNING'`),
  uniqueIndex('broker_action_instance_activation_uq').on(t.stepInstanceId, t.stepStartedAt)
    .where(sql`${t.stepStartedAt} IS NOT NULL`),
  check('broker_action_instance_state_ck', sql`${t.state} in ('RUNNING','COMPLETED','ABORTED')`),
]);
export type BrokerActionInstance = typeof brokerActionInstance.$inferSelect;
