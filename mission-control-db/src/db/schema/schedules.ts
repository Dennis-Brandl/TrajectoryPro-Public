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

// Work-center workflow scheduling (spec 2026-11-08 §5.3-5.5, §8.1, migration 0046).
// Master Schedule = the editable definition; Runtime Schedule = the frozen, running copy.
import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, index, uniqueIndex, check, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { appUser } from './identity.js';
import { workCenter } from './work-centers.js';

const sqlInList = (values: readonly string[]) => sql.raw(`(${values.map((v) => `'${v}'`).join(',')})`);

/** How a run can end; a chained item's `trigger_on` is a non-empty subset of these. */
export const SCHEDULE_ENDINGS = ['completed', 'stopped', 'aborted', 'errored'] as const;
export type ScheduleEnding = (typeof SCHEDULE_ENDINGS)[number];
export const MASTER_SCHEDULE_SOURCES = ['commander', 'api'] as const;
export const RUNTIME_SCHEDULE_STATUSES = ['active', 'paused', 'cancelled', 'finished'] as const;
export type RuntimeScheduleStatus = (typeof RUNTIME_SCHEDULE_STATUSES)[number];
export const SCHEDULE_OCCURRENCE_ORIGINS = ['on_time', 'late', 'resume'] as const;
export const SCHEDULE_ITEM_RUN_STATUSES = [
  'started', 'finished', 'not_triggered', 'skipped_disabled', 'held', 'start_requested',
  'cancelled', 'skipped_on_resume', 'failed_to_start', 'lost',
] as const;
export type ScheduleItemRunStatus = (typeof SCHEDULE_ITEM_RUN_STATUSES)[number];
export const SCHEDULE_ACTOR_KINDS = ['user', 'api_client', 'system'] as const;

export const masterSchedule = pgTable('master_schedule', {
  id: uuid('id').primaryKey().defaultRandom(),
  workCenterId: uuid('work_center_id').notNull().references(() => workCenter.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  recurrence: jsonb('recurrence').notNull(),
  source: text('source').notNull().default('commander'),
  externalKey: text('external_key'),
  revision: integer('revision').notNull().default(1),
  createdBy: uuid('created_by').references(() => appUser.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => appUser.id, { onDelete: 'set null' }),
  updatedByClient: uuid('updated_by_client'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('master_schedule_wc_name_uq').on(t.workCenterId, t.name),
  // Postgres treats NULLs as distinct, so any number of keyless Masters coexist.
  uniqueIndex('master_schedule_wc_external_key_uq').on(t.workCenterId, t.externalKey),
  check('master_schedule_source_ck', sql`${t.source} in ${sqlInList(MASTER_SCHEDULE_SOURCES)}`),
]);
export type MasterSchedule = typeof masterSchedule.$inferSelect;

export const masterScheduleItem = pgTable('master_schedule_item', {
  id: uuid('id').primaryKey().defaultRandom(),
  masterScheduleId: uuid('master_schedule_id').notNull().references(() => masterSchedule.id, { onDelete: 'cascade' }),
  parentItemId: uuid('parent_item_id').references((): AnyPgColumn => masterScheduleItem.id, { onDelete: 'cascade' }),
  position: integer('position').notNull().default(0),
  workflowName: text('workflow_name').notNull(),
  // NULL = resolve at Enable.
  workflowVersion: text('workflow_version'),
  triggerOn: text('trigger_on').array(),
  params: jsonb('params'),
}, (t) => [
  index('master_schedule_item_schedule_idx').on(t.masterScheduleId),
  index('master_schedule_item_parent_idx').on(t.parentItemId),
]);
export type MasterScheduleItem = typeof masterScheduleItem.$inferSelect;

export const runtimeSchedule = pgTable('runtime_schedule', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Records outlive the work center and the Master (as runtime_history does), so SET NULL plus a frozen name.
  workCenterId: uuid('work_center_id').references(() => workCenter.id, { onDelete: 'set null' }),
  workCenterName: text('work_center_name').notNull(),
  masterScheduleId: uuid('master_schedule_id').references(() => masterSchedule.id, { onDelete: 'set null' }),
  runtimeNumber: integer('runtime_number').notNull(),
  label: text('label').notNull(),
  name: text('name').notNull(),
  recurrence: jsonb('recurrence').notNull(),
  timeZone: text('time_zone').notNull(),
  masterRevision: integer('master_revision').notNull(),
  // SHA-256 of the canonical definition frozen at Enable: what a re-send compares itself to (§8.3).
  definitionHash: text('definition_hash').notNull(),
  // Copied from the Master, so a re-send still finds this Runtime after the Master is deleted. Null for a Commander-made one.
  externalKey: text('external_key'),
  // Started by Run Once: it may overlap anything, so the one-live-per-Master rule leaves it out.
  runOnce: boolean('run_once').notNull().default(false),
  // A caller's id for this Run Once, so a retried request finds the first one rather than starting another.
  runOnceRequestId: text('run_once_request_id'),
  status: text('status').notNull().default('active'),
  nextFireAt: timestamp('next_fire_at', { withTimezone: true }),
  missedFrom: timestamp('missed_from', { withTimezone: true }),
  missedTo: timestamp('missed_to', { withTimezone: true }),
  catchupMode: text('catchup_mode'),
  catchupCursor: timestamp('catchup_cursor', { withTimezone: true }),
  catchupTo: timestamp('catchup_to', { withTimezone: true }),
  enabledByUser: uuid('enabled_by_user').references(() => appUser.id, { onDelete: 'set null' }),
  enabledByClient: uuid('enabled_by_client'),
  enabledAt: timestamp('enabled_at', { withTimezone: true }).notNull().defaultNow(),
  pausedAt: timestamp('paused_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  // Off the list, and nothing else. The row stays: its number keeps a label from being reused, and a
  // re-send (§8.3) and a repeated Run Once requestId still find it.
  removedAt: timestamp('removed_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('runtime_schedule_one_live_per_master_uq').on(t.masterScheduleId)
    .where(sql`${t.status} in ('active','paused') and not ${t.runOnce}`),
  uniqueIndex('runtime_schedule_run_once_request_uq').on(t.masterScheduleId, t.runOnceRequestId)
    .where(sql`${t.runOnceRequestId} is not null`),
  // A deleted Master's Runtime carries on, so the Master's own index cannot see it.
  uniqueIndex('runtime_schedule_one_live_per_key_uq').on(t.workCenterId, t.externalKey)
    .where(sql`${t.status} in ('active','paused') and ${t.externalKey} is not null`),
  index('runtime_schedule_key_latest_idx').on(t.workCenterId, t.externalKey, t.runtimeNumber)
    .where(sql`${t.externalKey} is not null`),
  index('runtime_schedule_wc_idx').on(t.workCenterId, t.status),
  index('runtime_schedule_due_idx').on(t.nextFireAt).where(sql`${t.status} = 'active'`),
  check('runtime_schedule_status_ck', sql`${t.status} in ${sqlInList(RUNTIME_SCHEDULE_STATUSES)}`),
]);
export type RuntimeSchedule = typeof runtimeSchedule.$inferSelect;

export const runtimeScheduleItem = pgTable('runtime_schedule_item', {
  id: uuid('id').primaryKey().defaultRandom(),
  runtimeScheduleId: uuid('runtime_schedule_id').notNull().references(() => runtimeSchedule.id, { onDelete: 'cascade' }),
  parentItemId: uuid('parent_item_id').references((): AnyPgColumn => runtimeScheduleItem.id, { onDelete: 'cascade' }),
  position: integer('position').notNull().default(0),
  triggerOn: text('trigger_on').array(),
  params: jsonb('params'),
  // Soft link, NO FK: Task 5's guards protect the row, and an FK would block deleting a work
  // center that has ended Runtime Schedules.
  workflowId: uuid('workflow_id'),
  // Set to NULL when the Runtime Schedule ends.
  specJsonb: jsonb('spec_jsonb'),
  masterName: text('master_name').notNull(),
  masterOid: text('master_oid').notNull(),
  masterVersion: text('master_version').notNull(),
  masterState: text('master_state').notNull(),
  disabled: boolean('disabled').notNull().default(false),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  disabledBy: uuid('disabled_by').references(() => appUser.id, { onDelete: 'set null' }),
}, (t) => [
  index('runtime_schedule_item_schedule_idx').on(t.runtimeScheduleId),
  index('runtime_schedule_item_parent_idx').on(t.parentItemId),
  index('runtime_schedule_item_workflow_idx').on(t.workflowId),
]);
export type RuntimeScheduleItem = typeof runtimeScheduleItem.$inferSelect;

export const scheduleOccurrence = pgTable('schedule_occurrence', {
  id: uuid('id').primaryKey().defaultRandom(),
  runtimeScheduleId: uuid('runtime_schedule_id').notNull().references(() => runtimeSchedule.id, { onDelete: 'cascade' }),
  number: integer('number').notNull(),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
  firedAt: timestamp('fired_at', { withTimezone: true }),
  origin: text('origin').notNull().default('on_time'),
  // Set when the pass is written to schedule_history, so a purged record is never written again.
  historyRecordedAt: timestamp('history_recorded_at', { withTimezone: true }),
}, (t) => [
  // The once-only guard for a slot.
  uniqueIndex('schedule_occurrence_slot_uq').on(t.runtimeScheduleId, t.scheduledAt),
  index('schedule_occurrence_unrecorded_idx').on(t.firedAt).where(sql`${t.historyRecordedAt} is null`),
  check('schedule_occurrence_origin_ck', sql`${t.origin} in ${sqlInList(SCHEDULE_OCCURRENCE_ORIGINS)}`),
]);
export type ScheduleOccurrence = typeof scheduleOccurrence.$inferSelect;

export const scheduleItemRun = pgTable('schedule_item_run', {
  id: uuid('id').primaryKey().defaultRandom(),
  occurrenceId: uuid('occurrence_id').notNull().references(() => scheduleOccurrence.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id').notNull().references(() => runtimeScheduleItem.id, { onDelete: 'cascade' }),
  parentRunId: uuid('parent_run_id'),
  // Soft link, NO FK, like runtime_history.
  workflowInstanceId: uuid('workflow_instance_id'),
  runtimeLabel: text('runtime_label'),
  status: text('status').notNull().default('started'),
  finalState: text('final_state'),
  triggerValues: jsonb('trigger_values'),
  detail: text('detail'),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  acknowledgedBy: uuid('acknowledged_by').references(() => appUser.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (t) => [
  // The once-only guard for chains.
  uniqueIndex('schedule_item_run_occ_item_uq').on(t.occurrenceId, t.itemId),
  index('schedule_item_run_started_idx').on(t.status).where(sql`${t.status} = 'started'`),
  // Catch-up looks for these on every tick, oldest first.
  index('schedule_item_run_start_requested_idx').on(t.createdAt).where(sql`${t.status} = 'start_requested'`),
  index('schedule_item_run_instance_idx').on(t.workflowInstanceId),
  check('schedule_item_run_status_ck', sql`${t.status} in ${sqlInList(SCHEDULE_ITEM_RUN_STATUSES)}`),
]);
export type ScheduleItemRun = typeof scheduleItemRun.$inferSelect;

/** One workflow of a recorded pass, frozen when the pass ended. */
export type ScheduleHistoryWorkflow = {
  /** Item run id; `parentRunId` points at the run whose ending started this one. */
  runId: string;
  parentRunId: string | null;
  name: string;
  version: string;
  status: ScheduleItemRunStatus;
  finalState: string | null;
  runtimeLabel: string | null;
  workflowInstanceId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  startingValues: Record<string, string> | null;
  detail: string | null;
};

// One completed pass of a Runtime Schedule: every workflow it started, chains included, has ended.
// Frozen copies and soft links, like runtime_history: it outlives its Runtime and Master. The
// History purge clears it.
export const scheduleHistory = pgTable('schedule_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  occurrenceId: uuid('occurrence_id').notNull(),
  runtimeScheduleId: uuid('runtime_schedule_id'),
  workCenterId: uuid('work_center_id').references(() => workCenter.id, { onDelete: 'set null' }),
  workCenterName: text('work_center_name').notNull(),
  scheduleLabel: text('schedule_label').notNull(),
  scheduleName: text('schedule_name').notNull(),
  runOnce: boolean('run_once').notNull().default(false),
  timeZone: text('time_zone').notNull(),
  occurrenceNumber: integer('occurrence_number').notNull(),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }).notNull(),
  origin: text('origin').notNull(),
  workflows: jsonb('workflows').$type<ScheduleHistoryWorkflow[]>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('schedule_history_occurrence_uq').on(t.occurrenceId),
  index('schedule_history_wc_idx').on(t.workCenterId, t.finishedAt),
  index('schedule_history_finished_idx').on(t.finishedAt),
]);
export type ScheduleHistory = typeof scheduleHistory.$inferSelect;

// Append-only audit log. Soft links only: rows must never block a delete.
export const runtimeScheduleEvent = pgTable('runtime_schedule_event', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorKind: text('actor_kind').notNull(),
  actorId: text('actor_id'),
  actorName: text('actor_name'),
  action: text('action').notNull(),
  detail: jsonb('detail'),
  masterScheduleId: uuid('master_schedule_id'),
  runtimeScheduleId: uuid('runtime_schedule_id'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('runtime_schedule_event_runtime_idx').on(t.runtimeScheduleId, t.at),
  index('runtime_schedule_event_master_idx').on(t.masterScheduleId, t.at),
  check('runtime_schedule_event_actor_ck', sql`${t.actorKind} in ${sqlInList(SCHEDULE_ACTOR_KINDS)}`),
]);
export type RuntimeScheduleEvent = typeof runtimeScheduleEvent.$inferSelect;

// REST credentials (spec §8.1). Only the SHA-256 of the token is stored.
export const apiClient = pgTable('api_client', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull(),
  tokenPrefix: text('token_prefix').notNull(),
  scopes: text('scopes').array().notNull().default(sql`'{}'::text[]`),
  workCenterIds: uuid('work_center_ids').array().notNull().default(sql`'{}'::uuid[]`),
  createdBy: uuid('created_by').references(() => appUser.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('api_client_token_hash_uq').on(t.tokenHash),
]);
export type ApiClient = typeof apiClient.$inferSelect;
