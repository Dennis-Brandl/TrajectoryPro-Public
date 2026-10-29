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

import { pgTable, uuid, text, integer, jsonb, timestamp, bigint, index, uniqueIndex, check, foreignKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { appUser, role } from './identity.js';
import { workCenter } from './work-centers.js';
import { workflow } from './workflows.js';
import { environmentSpec } from './environments.js';

// Status vocabularies — the single source of truth. The CHECK constraints below are
// GENERATED from these arrays (sqlInList), so a vocabulary edit cannot silently diverge
// from the DB constraint; consumers import the arrays/types instead of hand-mirroring.
export const RUNTIME_WORKFLOW_STATUSES = ['pending','queued','running','pausing','paused','resuming','stopping','aborting','completed','aborted','errored','stopped'] as const;
export type RuntimeWorkflowStatus = (typeof RUNTIME_WORKFLOW_STATUSES)[number];
export const RUNTIME_ACTIVE_STATUSES = ['queued','running','pausing','paused','resuming','stopping','aborting'] as const;
export const ENGINE_STEP_STATES = ['READY','EXECUTING','WAITING_ACTION','WAITING_USER','WAITING_GATE','WAITING_PROPERTIES','WAITING_SCRIPT','PAUSED','COMPLETED','ERRORED','ABORTED','CANCELLED'] as const;
export type EngineStepState = (typeof ENGINE_STEP_STATES)[number];
export const RUNTIME_DELETABLE_STATUSES = ['pending','completed','aborted','stopped','errored'] as const;
export const RUNTIME_FINAL_STATES = ['completed','aborted','stopped','errored'] as const;
export type RuntimeFinalState = (typeof RUNTIME_FINAL_STATES)[number];
export const ASSIGNMENT_STATUSES = ['offered', 'claimed', 'completed', 'cancelled'] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];
export const LIVE_ASSIGNMENT_STATUSES = ['offered', 'claimed'] as const;

/** Renders ('a','b',…) for a CHECK in-list. The output must stay byte-identical to the
 *  hand-written lists the migrations shipped with, so `drizzle-kit generate` keeps
 *  reporting "no schema changes" — verified by the generate run staying empty. */
const sqlInList = (values: readonly string[]) => sql.raw(`(${values.map((v) => `'${v}'`).join(',')})`);

export const workflowInstance = pgTable('workflow_instance', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowId: uuid('workflow_id').notNull(),
  workCenterId: uuid('work_center_id').notNull().references(() => workCenter.id, { onDelete: 'restrict' }),
  // NOTE: no .references() here — the `schedule` table doesn't exist until Task 7.1.
  // The FK to schedule(id) ON DELETE SET NULL will be added then via a custom ALTER-TABLE migration.
  scheduleId: uuid('schedule_id'),
  environmentSpecId: uuid('environment_spec_id').references(() => environmentSpec.id, { onDelete: 'set null' }),
  triggeredBy: text('triggered_by').notNull(),
  status: text('status').notNull().default('pending'),
  finalState: text('final_state'),
  propertyStore: jsonb('property_store'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => appUser.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  specJsonb: jsonb('spec_jsonb').notNull(),
  startingParams: jsonb('starting_params'),
  runtimeNumber: integer('runtime_number').notNull(),
  masterName: text('master_name').notNull(),
  masterOid: text('master_oid').notNull(),
  masterVersion: text('master_version').notNull(),
  masterState: text('master_state').notNull(),
  queuedAt: timestamp('queued_at', { withTimezone: true }),
  startRequestedBy: uuid('start_requested_by').references(() => appUser.id, { onDelete: 'set null' }),
  engineState: jsonb('engine_state'),
  // Spec 2026-10-07 §3: rendered once at creation from the work center's template and never
  // rewritten — not by a template edit, not by a work-center rename.
  runtimeLabel: text('runtime_label').notNull(),
  // Spec 2026-10-15 §2 (distributed workflow actions): the runtime whose action created this one.
  // Soft links, no FK — the creator is swept on its own retention clock. created_by_label is a
  // frozen "Work Center/RW-12" display text for the same reason runtime_label is frozen.
  createdByInstanceId: uuid('created_by_instance_id'),
  createdByStepInstanceId: uuid('created_by_step_instance_id'),
  // The creating step's ACTIVATION: the engine reuses a step_instance row when a loop re-enters
  // the step (same id, fresh started_at), so the step id alone would hand pass 2 pass 1's child.
  createdByStepStartedAt: timestamp('created_by_step_started_at', { withTimezone: true }),
  createdByLabel: text('created_by_label'),
}, (t) => [
  // A workflow belongs to exactly one work center, so an instance's work center must agree
  // with its workflow's. Pinned here rather than trusted (spec §4.4).
  foreignKey({
    columns: [t.workCenterId, t.workflowId],
    foreignColumns: [workflow.workCenterId, workflow.id],
    name: 'workflow_instance_wc_workflow_fk',
  }).onDelete('restrict'),
  index('workflow_instance_wc_status_idx').on(t.workCenterId, t.status),
  index('workflow_instance_workflow_idx').on(t.workflowId),
  check('workflow_instance_trigger_ck', sql`${t.triggeredBy} in ('schedule','manual','event','workflow')`),
  // Spec 2026-10-15 §3 exactly-once: one runtime per creating step ACTIVATION (step instance +
  // its started_at), so an engine re-invoke after a lost action instance finds the runtime it
  // already created, while a loop's next pass through the same step creates a new one.
  uniqueIndex('workflow_instance_created_by_step_uq').on(t.createdByStepInstanceId, t.createdByStepStartedAt)
    .where(sql`${t.createdByStepInstanceId} is not null`),
  index('workflow_instance_created_by_idx').on(t.createdByInstanceId),
  check('workflow_instance_status_ck', sql`${t.status} in ${sqlInList(RUNTIME_WORKFLOW_STATUSES)}`),
  uniqueIndex('workflow_instance_wc_number_uq').on(t.workCenterId, t.runtimeNumber),
  uniqueIndex('workflow_instance_wc_label_uq').on(t.workCenterId, t.runtimeLabel),
  // Retention sweep (engine core/sweep.ts): oldest-first scan of one work center's finished runs.
  index('workflow_instance_finished_idx').on(t.workCenterId, t.completedAt)
    .where(sql`${t.status} in ('completed','aborted','stopped','errored')`),
  index('workflow_instance_queued_idx').on(t.queuedAt).where(sql`${t.status} = 'queued'`),
]);

export const stepInstance = pgTable('step_instance', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowInstanceId: uuid('workflow_instance_id').notNull().references(() => workflowInstance.id, { onDelete: 'cascade' }),
  nodeOid: text('node_oid').notNull(),
  stepOid: text('step_oid').notNull(),
  stepType: text('step_type').notNull(),
  state: text('state').notNull(),
  orderIndex: integer('order_index'),
  inputParams: jsonb('input_params'),
  outputParams: jsonb('output_params'),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  wakeAt: timestamp('wake_at', { withTimezone: true }),
  actionInstanceId: text('action_instance_id'),
  actionServerUri: text('action_server_uri'),
  // The action OID actually sent to the container at dispatch (spec 2026-08-20 §4.3):
  // strict = the workflow's oid; loose = the name-resolved container oid. Command-legality
  // checks read this (fallback to the workflow oid for pre-migration rows).
  actionInvokedOid: text('action_invoked_oid'),
}, (t) => [
  index('step_instance_state_idx').on(t.workflowInstanceId, t.state),
  index('step_instance_wake_idx').on(t.wakeAt).where(sql`${t.wakeAt} IS NOT NULL`),
  check('step_instance_state_ck', sql`${t.state} in ${sqlInList(ENGINE_STEP_STATES)}`),
]);

export const instanceAssignment = pgTable('instance_assignment', {
  id: uuid('id').primaryKey().defaultRandom(),
  stepInstanceId: uuid('step_instance_id').notNull().references(() => stepInstance.id, { onDelete: 'cascade' }),
  workCenterId: uuid('work_center_id').notNull().references(() => workCenter.id, { onDelete: 'restrict' }),
  resolvedRoleId: uuid('resolved_role_id').references(() => role.id, { onDelete: 'set null' }),
  assignedUserId: uuid('assigned_user_id').references(() => appUser.id, { onDelete: 'set null' }),
  preferredUserId: uuid('preferred_user_id').references(() => appUser.id, { onDelete: 'set null' }),
  // Sole-candidate auto-claim (spec 2026-08-17 D13): stamped by every release path with the
  // claimant the step was taken from; the sweep never claims a row back to this user. Cleared
  // by every claim path (manual, chain insert is a fresh row, sole-candidate UPDATE).
  releasedFromUserId: uuid('released_from_user_id').references(() => appUser.id, { onDelete: 'set null' }),
  allowedRoleIds: jsonb('allowed_role_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  status: text('status').notNull().default('offered'),
  dispatchPolicy: text('dispatch_policy'),
  dispatchReason: text('dispatch_reason'),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (t) => [
  index('instance_assignment_user_status_idx').on(t.assignedUserId, t.status),
  index('instance_assignment_step_idx').on(t.stepInstanceId),
  check('instance_assignment_status_ck', sql`${t.status} in ${sqlInList(ASSIGNMENT_STATUSES)}`),
  index('instance_assignment_wc_live_idx').on(t.workCenterId, t.status).where(sql`${t.status} IN ('offered','claimed')`),
  uniqueIndex('instance_assignment_step_live_uq').on(t.stepInstanceId).where(sql`${t.status} IN ('offered','claimed')`),
]);

export const traceEntry = pgTable('trace_entry', {
  id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
  workflowInstanceId: uuid('workflow_instance_id').notNull().references(() => workflowInstance.id, { onDelete: 'cascade' }),
  stepOid: text('step_oid'),
  state: text('state').notNull(),
  orderIndex: integer('order_index').notNull(),
  error: text('error'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  afterAction: integer('after_action'),
}, (t) => [index('trace_entry_instance_order_idx').on(t.workflowInstanceId, t.orderIndex)]);

export const operatorPresence = pgTable('operator_presence', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => appUser.id, { onDelete: 'cascade' }),
  attendingWorkCenterId: uuid('attending_work_center_id').notNull().references(() => workCenter.id, { onDelete: 'cascade' }),
  sessionId: text('session_id').notNull(),
  status: text('status').notNull().default('online'),
  lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('operator_presence_session_uq').on(t.sessionId),
  uniqueIndex('operator_presence_user_wc_uq').on(t.userId, t.attendingWorkCenterId),
  index('operator_presence_wc_status_idx').on(t.attendingWorkCenterId, t.status),
  check('operator_presence_status_ck', sql`${t.status} in ('online','away','offline')`),
]);

export const runtimeHistory = pgTable('runtime_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowInstanceId: uuid('workflow_instance_id'),   // soft link, NO FK: the instance gets deleted
  workCenterId: uuid('work_center_id').references(() => workCenter.id, { onDelete: 'set null' }),
  workCenterName: text('work_center_name').notNull(),
  runtimeNumber: integer('runtime_number').notNull(),
  // Spec 2026-10-07 §4.1: frozen copy, as work_center_name already is.
  runtimeLabel: text('runtime_label').notNull(),
  masterName: text('master_name').notNull(),
  masterOid: text('master_oid').notNull(),
  masterVersion: text('master_version').notNull(),
  masterState: text('master_state').notNull(),
  finalState: text('final_state').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }).notNull(),
  startingParams: jsonb('starting_params'),
  trace: jsonb('trace').notNull(),
  properties: jsonb('properties'),
  stepParams: jsonb('step_params'),
  stepNames: jsonb('step_names'),
  // Spec 2026-10-15 §2/§6.2: lineage (frozen copies) and the workflow-level outputs, so
  // Get Runtime Workflow Outputs works after the runtime is swept and its master deleted.
  createdByInstanceId: uuid('created_by_instance_id'),
  createdByLabel: text('created_by_label'),
  outputs: jsonb('outputs'),
  // Spec 2026-10-27: who started the run (frozen copies, no FK like the rest of the row).
  startedByUserId: uuid('started_by_user_id'),
  startedByLoginName: text('started_by_login_name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('runtime_history_instance_uq').on(t.workflowInstanceId),
  index('runtime_history_wc_idx').on(t.workCenterId, t.finishedAt),
  index('runtime_history_finished_idx').on(t.finishedAt),
  index('runtime_history_created_by_idx').on(t.createdByInstanceId),
  // Migration 0036 (spec 2026-10-07 §6.2): the allocator's label probe consults this
  // permanent, unbounded table on every allocation, not only on a bucket restart — so an
  // unindexed lookup here would degrade forever as history accumulates.
  index('runtime_history_wc_label_idx').on(t.workCenterId, t.runtimeLabel),
  check('runtime_history_final_state_ck', sql`${t.finalState} in ${sqlInList(RUNTIME_FINAL_STATES)}`),
]);
export type RuntimeHistory = typeof runtimeHistory.$inferSelect;
export type NewRuntimeHistory = typeof runtimeHistory.$inferInsert;

// Spec 2026-09-06 D6: one row per e-signature attempt. Survives the finished-instance sweep the
// way runtime_history does — soft links to the instance and step, denormalised names, FKs only
// to the identity/work-center rows (SET NULL). No FK to workflow_instance on purpose: the engine
// writes FAILED rows outside the instance's claimed transaction, and an FK there would take a
// KEY SHARE lock on the instance row (Ruling P9, operator-verbs.ts) — the deadlock class the
// operator verbs already had to design around.
export const SIGNATURE_OUTCOMES = ['signed', 'failed'] as const;
export type SignatureOutcome = (typeof SIGNATURE_OUTCOMES)[number];

export const stepSignature = pgTable('step_signature', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowInstanceId: uuid('workflow_instance_id').notNull(),   // soft link, NO FK
  runtimeNumber: integer('runtime_number').notNull(),
  // Spec 2026-10-07 §4.1: frozen copy, as work_center_name already is.
  runtimeLabel: text('runtime_label').notNull(),
  workCenterId: uuid('work_center_id').references(() => workCenter.id, { onDelete: 'set null' }),
  workCenterName: text('work_center_name').notNull(),
  stepInstanceId: uuid('step_instance_id'),                     // soft link, NO FK
  stepOid: text('step_oid').notNull(),
  stepName: text('step_name').notNull(),
  signerUserId: uuid('signer_user_id').references(() => appUser.id, { onDelete: 'set null' }),
  signerLoginName: text('signer_login_name').notNull(),
  signerDisplayName: text('signer_display_name'),
  roleId: uuid('role_id').references(() => role.id, { onDelete: 'set null' }),
  roleName: text('role_name'),
  operatorUserId: uuid('operator_user_id').references(() => appUser.id, { onDelete: 'set null' }),
  operatorLoginName: text('operator_login_name').notNull(),
  meaning: text('meaning'),
  decision: text('decision'),
  outcome: text('outcome').notNull(),
  failureCode: text('failure_code'),
  signedAt: timestamp('signed_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('step_signature_instance_idx').on(t.workflowInstanceId),
  index('step_signature_wc_signed_idx').on(t.workCenterId, t.signedAt.desc()),
  check('step_signature_outcome_ck', sql`${t.outcome} in ${sqlInList(SIGNATURE_OUTCOMES)}`),
]);
export type StepSignature = typeof stepSignature.$inferSelect;
export type NewStepSignature = typeof stepSignature.$inferInsert;

// Spec 2026-10-27: one row per execution of a workflow step (the record behind the runtime
// workflow PDF). Soft-linked to the instance and step exactly like step_signature, for the same
// reason (no KEY SHARE lock on the instance row; survives the finished-instance sweep). No unique
// index: a double write must not abort the engine's transaction.
export const STEP_RUN_RESULTS = ['completed', 'failed', 'caught', 'aborted', 'stopped', 'cancelled'] as const;
export type StepRunResult = (typeof STEP_RUN_RESULTS)[number];
export const STEP_RUN_KINDS = ['user', 'script', 'action', 'gate', 'system'] as const;
export type StepRunKind = (typeof STEP_RUN_KINDS)[number];
export type StepRunPathEntry = { proxyStepOid: string; proxyRun: number; workflowName: string };

export const stepRun = pgTable('step_run', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowInstanceId: uuid('workflow_instance_id').notNull(),   // soft link, NO FK
  runtimeLabel: text('runtime_label').notNull(),
  workCenterId: uuid('work_center_id').references(() => workCenter.id, { onDelete: 'set null' }),
  stepInstanceId: uuid('step_instance_id'),                     // soft link, NO FK
  stepOid: text('step_oid').notNull(),
  stepName: text('step_name').notNull(),
  stepType: text('step_type').notNull(),
  runNumber: integer('run_number').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }).notNull(),
  result: text('result').notNull(),
  error: text('error'),
  inputParameters: jsonb('input_parameters'),
  outputParameters: jsonb('output_parameters'),
  performedByUserId: uuid('performed_by_user_id').references(() => appUser.id, { onDelete: 'set null' }),
  performedByLoginName: text('performed_by_login_name'),
  performedByKind: text('performed_by_kind').notNull(),
  nodePath: jsonb('node_path').$type<StepRunPathEntry[]>().notNull().default(sql`'[]'::jsonb`),
}, (t) => [
  // Serves every per-instance read (prefix) and the per-step run counts (countStepRuns,
  // countStepRunsStartedBefore). The history list orders by coalesce(started_at, finished_at),
  // which no plain index can serve, and sorts one instance's rows only.
  index('step_run_instance_idx').on(t.workflowInstanceId, t.stepOid, t.startedAt),
  check('step_run_result_ck', sql`${t.result} in ${sqlInList(STEP_RUN_RESULTS)}`),
  check('step_run_kind_ck', sql`${t.performedByKind} in ${sqlInList(STEP_RUN_KINDS)}`),
]);
export type StepRun = typeof stepRun.$inferSelect;
export type NewStepRun = typeof stepRun.$inferInsert;

export type WorkflowInstance = typeof workflowInstance.$inferSelect;
export type StepInstance = typeof stepInstance.$inferSelect;
export type InstanceAssignment = typeof instanceAssignment.$inferSelect;
