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

import { pgTable, uuid, text, integer, boolean, timestamp, uniqueIndex, index, check, primaryKey, foreignKey, jsonb, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { appUser, role } from './identity.js';
import { workflow, workflowNode } from './workflows.js';

export const DISPATCH_POLICIES = ['least_queued_steps','highest_priority','round_robin','fewest_active_instances','manual'] as const;
export type DispatchPolicy = (typeof DISPATCH_POLICIES)[number];

export const workCenter = pgTable('work_center', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  // Optional ISA 88 type label (spec 2026-10-19); NULL = none.
  typeName: text('type_name'),
  parentWorkCenterId: uuid('parent_work_center_id').references((): AnyPgColumn => workCenter.id, { onDelete: 'restrict' }),
  sortOrder: integer('sort_order').notNull().default(0),
  dispatchPolicy: text('dispatch_policy').notNull().default('least_queued_steps'),
  // Auto-claim chains (spec 2026-08-14 D4): work-center default; workflow.autoClaim overrides.
  autoClaim: boolean('auto_claim').notNull().default(false),
  nextRuntimeNumber: integer('next_runtime_number').notNull().default(1),
  // Spec 2026-10-07 §4.1/§4.3. The template is NULL for an unconfigured work center, which
  // renders the built-in RW-<n>. runtimeSeqNext drives {SEQ} ONLY and restarts when
  // runtimeSeqBucket changes; nextRuntimeNumber above never restarts because runtime_number
  // orders the runtime list and the cross-work-center poll.
  runtimeIdTemplate: text('runtime_id_template'),
  runtimeSeqBucket: text('runtime_seq_bucket'),
  runtimeSeqNext: integer('runtime_seq_next').notNull().default(1),
  // Spec 2026-10-09 §8.1: this work center's Pilot theme override (one PilotTheme layer).
  // NULL = inherit everything from the parent chain and the site.
  pilotTheme: jsonb('pilot_theme'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  finishedRetentionSecs: integer('finished_retention_secs').notNull().default(3600),
}, (t) => [
  uniqueIndex('work_center_root_name_uq').on(t.name).where(sql`${t.parentWorkCenterId} is null`),
  uniqueIndex('work_center_child_name_uq').on(t.parentWorkCenterId, t.name).where(sql`${t.parentWorkCenterId} is not null`),
  index('work_center_parent_idx').on(t.parentWorkCenterId),
  check('work_center_dispatch_ck', sql`${t.dispatchPolicy} in ('least_queued_steps','highest_priority','round_robin','fewest_active_instances','manual')`),
]);

export type WorkCenter = typeof workCenter.$inferSelect;
export type NewWorkCenter = typeof workCenter.$inferInsert;

export const workCenterUser = pgTable('work_center_user', {
  workCenterId: uuid('work_center_id').notNull().references(() => workCenter.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => appUser.id, { onDelete: 'cascade' }),
  priority: integer('priority').notNull().default(0),
  missionSystemCommander: boolean('mission_system_commander').notNull().default(false),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.workCenterId, t.userId] })]);

export type WorkCenterUser = typeof workCenterUser.$inferSelect;
export type NewWorkCenterUser = typeof workCenterUser.$inferInsert;

/**
 * Per-work-center role membership (spec 2026-09-06 D1). REPLACES the former global
 * `user_role`: a user holds a role only within a specific work center. The composite FK
 * onto work_center_user makes "holds role R in W" imply "is a member of W", and unassigning
 * a member cascades their roles away. role_id cascades like user_role did, so deleteRole
 * keeps its contract: allowed-role grants RESTRICT (ROLE_IN_USE), memberships vanish.
 */
export const workCenterUserRole = pgTable('work_center_user_role', {
  workCenterId: uuid('work_center_id').notNull(),
  userId: uuid('user_id').notNull(),
  roleId: uuid('role_id').notNull().references(() => role.id, { onDelete: 'cascade' }),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.workCenterId, t.userId, t.roleId] }),
  foreignKey({
    name: 'work_center_user_role_member_fk',
    columns: [t.workCenterId, t.userId],
    foreignColumns: [workCenterUser.workCenterId, workCenterUser.userId],
  }).onDelete('cascade'),
  index('work_center_user_role_role_idx').on(t.roleId),
]);

export type WorkCenterUserRole = typeof workCenterUserRole.$inferSelect;
export type NewWorkCenterUserRole = typeof workCenterUserRole.$inferInsert;

export const workflowAllowedRole = pgTable('workflow_allowed_role', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowId: uuid('workflow_id').notNull().references(() => workflow.id, { onDelete: 'cascade' }),
  workflowNodeId: uuid('workflow_node_id').notNull().references(() => workflowNode.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').notNull().references(() => role.id, { onDelete: 'restrict' }),
}, (t) => [
  uniqueIndex('workflow_allowed_role_uq').on(t.workflowId, t.workflowNodeId, t.roleId),
  index('workflow_allowed_role_node_idx').on(t.workflowNodeId),
]);

export type WorkflowAllowedRole = typeof workflowAllowedRole.$inferSelect;
export type NewWorkflowAllowedRole = typeof workflowAllowedRole.$inferInsert;

// Roles named by a workflow entry's e-signature blocks (form_document `roleName`, spec
// 2026-09-06 D8: exact name match). Written by the .WFmasterX ingest so the role exists in
// the catalogue before the first signature is attempted, and so the work_center_role VIEW
// (allowed roles ∪ signature roles) lists it under "roles used in workflows". RESTRICT on
// role deletion for the same reason allowed-role rows do: deleting the role would turn every
// signature on the step into SIGNATURE_ROLE_UNKNOWN.
export const workflowSignatureRole = pgTable('workflow_signature_role', {
  workflowId: uuid('workflow_id').notNull().references(() => workflow.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').notNull().references(() => role.id, { onDelete: 'restrict' }),
}, (t) => [
  primaryKey({ columns: [t.workflowId, t.roleId] }),
  index('workflow_signature_role_role_idx').on(t.roleId),
]);

export type WorkflowSignatureRole = typeof workflowSignatureRole.$inferSelect;
export type NewWorkflowSignatureRole = typeof workflowSignatureRole.$inferInsert;
