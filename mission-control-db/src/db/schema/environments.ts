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

import { pgTable, uuid, text, jsonb, timestamp, uniqueIndex, index, primaryKey, check, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { appUser } from './identity.js';
import { workflow } from './workflows.js';
import { workCenter } from './work-centers.js';
import { type WorkCenter } from './work-centers.js';

export const environmentSpec = pgTable('environment_spec', {
  id: uuid('id').primaryKey().defaultRandom(),
  oid: text('oid').notNull(),
  name: text('name').notNull(),
  workCenterId: uuid('work_center_id').notNull().references(() => workCenter.id, { onDelete: 'cascade' }),
  parentEnvironmentSpecId: uuid('parent_environment_spec_id').references((): AnyPgColumn => environmentSpec.id, { onDelete: 'set null' }),
  version: text('version').notNull().default('1.0.0'),
  state: text('state').notNull().default('Draft'),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }),
  schemaVersion: text('schema_version'),
  specJsonb: jsonb('spec_jsonb').notNull(),
  sourceFilename: text('source_filename'),
  sourceLibraryName: text('source_library_name'),
  sourceLibraryOid: text('source_library_oid'),
  downloadedAt: timestamp('downloaded_at', { withTimezone: true }).notNull().defaultNow(),
  downloadedBy: uuid('downloaded_by').references(() => appUser.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('environment_spec_entry_uq').on(t.workCenterId, t.oid, t.version, t.state),
  index('environment_spec_oid_idx').on(t.oid),
  index('environment_spec_wc_name_idx').on(t.workCenterId, t.name),
]);

export const workflowEnvironment = pgTable('workflow_environment', {
  workflowId: uuid('workflow_id').notNull().references(() => workflow.id, { onDelete: 'cascade' }),
  environmentSpecId: uuid('environment_spec_id').notNull().references(() => environmentSpec.id, { onDelete: 'cascade' }),
  source: text('source').notNull().default('download'),
  linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.workflowId, t.environmentSpecId] }),
  check('workflow_environment_source_ck', sql`${t.source} in ('download','manual')`),
]);

export type EnvironmentSpec = typeof environmentSpec.$inferSelect;
export type NewEnvironmentSpec = typeof environmentSpec.$inferInsert;

export const workCenterEnvironmentBinding = pgTable('work_center_environment_binding', {
  workCenterId: uuid('work_center_id').notNull().references(() => workCenter.id, { onDelete: 'cascade' }),
  environmentOid: text('environment_oid').notNull(),
  serverUri: text('server_uri').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => appUser.id, { onDelete: 'set null' }),
}, (t) => [primaryKey({ columns: [t.workCenterId, t.environmentOid] })]);
export type WorkCenterEnvironmentBinding = typeof workCenterEnvironmentBinding.$inferSelect;
