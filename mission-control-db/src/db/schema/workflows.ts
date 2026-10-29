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

import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, uniqueIndex, index, check, primaryKey, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { appUser } from './identity.js';
import { workCenter } from './work-centers.js';

export const workflow = pgTable('workflow', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Designer's immutable spec id. NOT a key here (spec D1) — one oid may repeat in a work
  // center at different versions AND different states.
  oid: text('oid').notNull(),
  name: text('name').notNull(),
  // Optional ISA 88 type label of the root workflow (spec 2026-10-19); NULL = none.
  typeName: text('type_name'),
  workCenterId: uuid('work_center_id').notNull().references(() => workCenter.id, { onDelete: 'cascade' }),
  version: text('version').notNull().default('1.0.0'),
  state: text('state').notNull().default('Draft'),
  // Absorbed from the retired work_center_workflow link row.
  dispatchPolicy: text('dispatch_policy'),
  // Auto-claim override (spec 2026-08-14 D4): null = inherit the work center's autoClaim.
  autoClaim: boolean('auto_claim'),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }),
  schemaVersion: text('schema_version'),
  specJsonb: jsonb('spec_jsonb').notNull(),
  sourceFilename: text('source_filename'),
  // Designer's originating library. Traceability ONLY (spec D9) — never routes or groups.
  sourceLibraryName: text('source_library_name'),
  sourceLibraryOid: text('source_library_oid'),
  checksum: text('checksum'),
  downloadedAt: timestamp('downloaded_at', { withTimezone: true }).notNull().defaultNow(),
  downloadedBy: uuid('downloaded_by').references(() => appUser.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // THE no-op rule (spec D3). A colliding load is reported "already present", never inserted.
  uniqueIndex('workflow_entry_uq').on(t.workCenterId, t.oid, t.version, t.state),
  // FK target for the composite FKs on workflow_instance and schedule. Redundant with the
  // PK, but Postgres requires a unique constraint on the exact referenced column list.
  uniqueIndex('workflow_wc_id_uq').on(t.workCenterId, t.id),
  index('workflow_oid_idx').on(t.oid),
  index('workflow_wc_name_idx').on(t.workCenterId, t.name),
  check('workflow_dispatch_ck', sql`${t.dispatchPolicy} is null or ${t.dispatchPolicy} in ('least_queued_steps','highest_priority','round_robin','fewest_active_instances','manual')`),
]);

export const workflowNode = pgTable('workflow_node', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowId: uuid('workflow_id').notNull().references(() => workflow.id, { onDelete: 'cascade' }),
  nodeOid: text('node_oid').notNull(),
  parentNodeId: uuid('parent_node_id').references((): AnyPgColumn => workflowNode.id, { onDelete: 'cascade' }),
  parentChildSpecOid: text('parent_child_spec_oid'),
  name: text('name').notNull(),
  version: text('version'),
  state: text('state'),
  depth: integer('depth').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('workflow_node_oid_uq').on(t.workflowId, t.nodeOid),
  index('workflow_node_workflow_idx').on(t.workflowId),
  index('workflow_node_parent_idx').on(t.parentNodeId),
]);

export const workflowUiStep = pgTable('workflow_ui_step', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowId: uuid('workflow_id').notNull().references(() => workflow.id, { onDelete: 'cascade' }),
  owningNodeId: uuid('owning_node_id').notNull().references(() => workflowNode.id, { onDelete: 'cascade' }),
  stepOid: text('step_oid').notNull(),
  name: text('name'),
  stepType: text('step_type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('workflow_ui_step_uq').on(t.workflowId, t.stepOid),
  index('workflow_ui_step_node_idx').on(t.owningNodeId),
]);

// Image bytes referenced by a workflow entry's form_document image blocks (and UI
// parameter images), extracted from the .WFmasterX's images/ ZIP entries at ingest.
// Keyed by the BARE filename — exactly the src key a form_document image block carries —
// so the engine's per-instance image endpoint can serve `src` lookups directly.
// Base64 text rather than bytea: both real pg and the PGlite test driver round-trip
// text identically, and images are decoded once per HTTP serve, not per inbox build.
// Cascades with its workflow row; deleteWorkflow refuses while instances exist, so an
// instance's images outlive every live run that can reference them.
export const workflowImage = pgTable('workflow_image', {
  workflowId: uuid('workflow_id').notNull().references(() => workflow.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  dataBase64: text('data_base64').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.workflowId, t.filename], name: 'workflow_image_pk' }),
]);

export type Workflow = typeof workflow.$inferSelect;
export type NewWorkflow = typeof workflow.$inferInsert;
export type WorkflowNode = typeof workflowNode.$inferSelect;
export type WorkflowUiStep = typeof workflowUiStep.$inferSelect;
export type WorkflowImage = typeof workflowImage.$inferSelect;
