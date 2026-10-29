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

import { pgTable, uuid, text, boolean, jsonb, timestamp, index, check, foreignKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { appUser } from './identity.js';
import { workCenter } from './work-centers.js';
import { workflow } from './workflows.js';
import { environmentSpec } from './environments.js';
import { workflowInstance } from './execution.js';

export const schedule = pgTable('schedule', {
  id: uuid('id').primaryKey().defaultRandom(),
  workCenterId: uuid('work_center_id').notNull().references(() => workCenter.id, { onDelete: 'cascade' }),
  workflowId: uuid('workflow_id').notNull(),
  environmentSpecId: uuid('environment_spec_id').references(() => environmentSpec.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  runAt: timestamp('run_at', { withTimezone: true }),
  cronExpr: text('cron_expr'),
  timezone: text('timezone').default('UTC'),
  nextFireAt: timestamp('next_fire_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => appUser.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // A workflow belongs to exactly one work center, so a schedule's work center must agree
  // with its workflow's. Pinned here rather than trusted (spec §4.4).
  foreignKey({
    columns: [t.workCenterId, t.workflowId],
    foreignColumns: [workflow.workCenterId, workflow.id],
    name: 'schedule_wc_workflow_fk',
  }).onDelete('restrict'),
  index('schedule_work_center_idx').on(t.workCenterId),
  index('schedule_next_fire_idx').on(t.nextFireAt).where(sql`${t.enabled}`),
  check('schedule_kind_ck', sql`${t.kind} in ('one_time','recurring','event')`),
]);

export const triggerCondition = pgTable('trigger_condition', {
  id: uuid('id').primaryKey().defaultRandom(),
  scheduleId: uuid('schedule_id').notNull().references(() => schedule.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  expression: jsonb('expression').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check('trigger_condition_type_ck', sql`${t.type} in ('time','data','event')`)]);

export const scheduleRun = pgTable('schedule_run', {
  id: uuid('id').primaryKey().defaultRandom(),
  scheduleId: uuid('schedule_id').notNull().references(() => schedule.id, { onDelete: 'cascade' }),
  firedAt: timestamp('fired_at', { withTimezone: true }).notNull().defaultNow(),
  workflowInstanceId: uuid('workflow_instance_id').references(() => workflowInstance.id, { onDelete: 'set null' }),
  status: text('status').notNull(),
  detail: text('detail'),
}, (t) => [
  index('schedule_run_schedule_idx').on(t.scheduleId, t.firedAt),
  // The SET NULL / cascade scan when a workflow_instance row is deleted.
  index('schedule_run_instance_idx').on(t.workflowInstanceId),
  check('schedule_run_status_ck', sql`${t.status} in ('fired','skipped','failed')`),
]);

export type Schedule = typeof schedule.$inferSelect;
export type NewSchedule = typeof schedule.$inferInsert;
export type TriggerCondition = typeof triggerCondition.$inferSelect;
export type NewTriggerCondition = typeof triggerCondition.$inferInsert;
export type ScheduleRun = typeof scheduleRun.$inferSelect;
export type NewScheduleRun = typeof scheduleRun.$inferInsert;
