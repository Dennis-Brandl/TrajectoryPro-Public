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

import {
  pgTable, uuid, text, integer, boolean, jsonb, timestamp, bigint,
  primaryKey, index, check, foreignKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { workCenter } from './work-centers.js';
import { environmentSpec } from './environments.js';
import { workflowInstance } from './execution.js';
import { appUser } from './identity.js';

// Vocabularies — the single source of truth, mirroring execution.ts's pattern: the CHECK
// constraints below are GENERATED from these arrays, so an edit here cannot silently
// diverge from the DB constraint.
//
// RESOURCE_TYPES matches ResourcePropertySpecification.resource_type in the engine's
// spec/types.ts. The strings are the wire values authored by Designer — do not "tidy" them.
export const RESOURCE_TYPES = [
  'binary exclusive use',
  'binary shared use with pool limits',
  'countable use with pool limits',
  'named pool',
  'sync',
] as const;
export type WcResourceType = (typeof RESOURCE_TYPES)[number];

// Queue-entry kinds. 'acquire' covers Acquire and Acquire Pool Amount (they differ only by
// `amount`); the three sync kinds map to the manager's sendQueue / receiveQueue / pendingSync.
export const WAITER_KINDS = ['acquire', 'send', 'receive', 'sync'] as const;
export type WcWaiterKind = (typeof WAITER_KINDS)[number];

const sqlInList = (values: readonly string[]) => sql.raw(`(${values.map((v) => `'${v}'`).join(',')})`);

/**
 * One shared resource pool, scoped to a work center (spec U2: work center + name is the
 * WHOLE identity — env oid, version and state are deliberately excluded, so instances on
 * different env versions still contend for the same pool).
 *
 * `in_use` / `available_names` are AUTHORITATIVE live state, mirroring the engine's
 * InMemoryResourceManager exactly so its toJSON/fromJSON round trip stays honest.
 * wc_resource_holder is a PARALLEL ledger, not the source of truth — the difference
 * between them is the "unaccounted" figure the CM panes surface (spec §4.1).
 *
 * Phase 1 only ever writes the DEFINITION columns. Live state stays at its defaults until
 * the Phase 2 engine cutover.
 */
export const wcResource = pgTable('wc_resource', {
  workCenterId: uuid('work_center_id').notNull().references(() => workCenter.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  resourceType: text('resource_type').notNull(),
  // NULL for binary exclusive / named pool / sync, where capacity comes from the type itself
  // — but ALSO NULL for a countable or shared pool whose declared count is 1: Designer's
  // resource editor omits use_limit in that case too, and the engine compensates by reading
  // `spec.use_limit ?? 1`. Phase 2 hydration off this table must apply that same `?? 1`
  // default, or a count-1 countable/shared pool would hydrate with the wrong (unlimited)
  // capacity instead of 1.
  useLimit: integer('use_limit'),
  // Named pool only: the registered roster (the manager's `originalNames`) and the names
  // currently free. A name held while the roster shrinks stays out of BOTH arrays, which is
  // exactly what makes releaseNamed() discard it rather than return it (spec §4.6).
  poolNames: jsonb('pool_names').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  availableNames: jsonb('available_names').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  inUse: integer('in_use').notNull().default(0),
  description: text('description'),
  // Provenance. NULL means ORPHANED: the declaring spec was deleted but the pool (and any
  // live holds on it) outlived it. The defined_from_* text survives that deletion so the
  // pane can still say what defined the row.
  definedByEnvSpecId: uuid('defined_by_env_spec_id').references(() => environmentSpec.id, { onDelete: 'set null' }),
  // Denormalized copy of the declaring spec's display name, mirroring defined_from_version /
  // defined_from_state: this text survives the declaring spec's deletion, so an orphaned
  // incumbent can still be named in a conflict warning even after Designer no longer has it.
  definedFromName: text('defined_from_name'),
  definedFromVersion: text('defined_from_version'),
  definedFromState: text('defined_from_state'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.workCenterId, t.name] }),
  check('wc_resource_type_ck', sql`${t.resourceType} in ${sqlInList(RESOURCE_TYPES)}`),
  // in_use may EXCEED use_limit (an over-committed pool after a use_limit shrink, spec §4.6),
  // so only the floor is constrained — the manager floors releases at 0.
  check('wc_resource_in_use_ck', sql`${t.inUse} >= 0`),
]);

export type WcResource = typeof wcResource.$inferSelect;
export type NewWcResource = typeof wcResource.$inferInsert;

/**
 * One queued waiter on a pool. THE IDENTITY COLUMN IS THE FIFO ORDER — every read that
 * cares about queue position must ORDER BY id, which is what preserves the manager's strict
 * FIFO including countable's deliberate "don't skip a too-large request" rule.
 *
 * `granted` is the cross-instance handoff: a release by instance A flips the head waiter's
 * row for instance B, and B's next hydrate consumes it. Empty until Phase 2.
 */
export const wcResourceWaiter = pgTable('wc_resource_waiter', {
  id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
  workCenterId: uuid('work_center_id').notNull(),
  name: text('name').notNull(),
  instanceId: uuid('instance_id').notNull().references(() => workflowInstance.id, { onDelete: 'cascade' }),
  stepOid: text('step_oid').notNull(),
  kind: text('kind').notNull(),
  amount: integer('amount'),
  payload: text('payload'),
  granted: boolean('granted').notNull().default(false),
  grantedName: text('granted_name'),
  grantedPayload: text('granted_payload'),
  enqueuedAt: timestamp('enqueued_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    columns: [t.workCenterId, t.name],
    foreignColumns: [wcResource.workCenterId, wcResource.name],
    name: 'wc_resource_waiter_resource_fk',
  }).onDelete('cascade'),
  index('wc_resource_waiter_fifo_idx').on(t.workCenterId, t.name, t.id),
  // The cascade scan when a workflow_instance row is deleted.
  index('wc_resource_waiter_instance_idx').on(t.instanceId),
  index('wc_resource_waiter_granted_idx').on(t.instanceId).where(sql`${t.granted}`),
  check('wc_resource_waiter_kind_ck', sql`${t.kind} in ${sqlInList(WAITER_KINDS)}`),
]);

export type WcResourceWaiter = typeof wcResourceWaiter.$inferSelect;
export type NewWcResourceWaiter = typeof wcResourceWaiter.$inferInsert;

/**
 * Who holds what. `amount` is the units held (1 for binary exclusive; N for countable and
 * shared); a named-pool holder is always amount = 1 with `held_name` set (spec §4.1).
 * Indexed on instance_id because auto-release on terminal is one DELETE on that column.
 * Empty until Phase 2.
 */
export const wcResourceHolder = pgTable('wc_resource_holder', {
  id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
  workCenterId: uuid('work_center_id').notNull(),
  name: text('name').notNull(),
  instanceId: uuid('instance_id').notNull().references(() => workflowInstance.id, { onDelete: 'cascade' }),
  stepOid: text('step_oid').notNull(),
  amount: integer('amount').notNull().default(1),
  heldName: text('held_name'),
  acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    columns: [t.workCenterId, t.name],
    foreignColumns: [wcResource.workCenterId, wcResource.name],
    name: 'wc_resource_holder_resource_fk',
  }).onDelete('cascade'),
  index('wc_resource_holder_resource_idx').on(t.workCenterId, t.name),
  index('wc_resource_holder_instance_idx').on(t.instanceId),
  check('wc_resource_holder_amount_ck', sql`${t.amount} > 0`),
]);

export type WcResourceHolder = typeof wcResourceHolder.$inferSelect;
export type NewWcResourceHolder = typeof wcResourceHolder.$inferInsert;

/**
 * One shared value-property entry. The registry is the ONLY home for an environment value
 * (spec U5) — there is no per-instance copy to reconcile against.
 *
 * There is deliberately no `description` column: PropertySpecification carries none, and
 * value-property annotation travels as a `Description` ENTRY inside entries[] (see plan D1).
 */
export const wcValueProperty = pgTable('wc_value_property', {
  workCenterId: uuid('work_center_id').notNull().references(() => workCenter.id, { onDelete: 'cascade' }),
  propertyName: text('property_name').notNull(),
  entryName: text('entry_name').notNull(),
  value: text('value').notNull().default(''),
  definedByEnvSpecId: uuid('defined_by_env_spec_id').references(() => environmentSpec.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // NULL when the engine wrote it; set when a commander edited it through the CM (Phase 4).
  updatedBy: uuid('updated_by').references(() => appUser.id, { onDelete: 'set null' }),
}, (t) => [
  primaryKey({ columns: [t.workCenterId, t.propertyName, t.entryName] }),
]);

export type WcValueProperty = typeof wcValueProperty.$inferSelect;
export type NewWcValueProperty = typeof wcValueProperty.$inferInsert;
