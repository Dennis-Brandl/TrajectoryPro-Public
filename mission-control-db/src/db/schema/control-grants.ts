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

import { pgTable, uuid, text, timestamp, index, primaryKey, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { appUser } from './identity.js';
import { workCenter } from './work-centers.js';

/** Spec 2026-10-15 §2.2 (R7): `own` = commands only reach runtimes the caller's lineage created;
 *  `any` = any runtime in the target work center. */
export const CONTROL_GRANT_SCOPES = ['own', 'any'] as const;
export type ControlGrantScope = (typeof CONTROL_GRANT_SCOPES)[number];

/** "Runtimes in work center `source` may create and command runtimes in work center `target`."
 *  The same work center never needs a row; a self-grant is refused. */
export const workCenterControlGrant = pgTable('work_center_control_grant', {
  sourceWorkCenterId: uuid('source_work_center_id').notNull().references(() => workCenter.id, { onDelete: 'cascade' }),
  targetWorkCenterId: uuid('target_work_center_id').notNull().references(() => workCenter.id, { onDelete: 'cascade' }),
  scope: text('scope').notNull().default('own'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by').references(() => appUser.id, { onDelete: 'set null' }),
}, (t) => [
  primaryKey({ columns: [t.sourceWorkCenterId, t.targetWorkCenterId] }),
  index('work_center_control_grant_target_idx').on(t.targetWorkCenterId),
  check('work_center_control_grant_scope_ck', sql`${t.scope} in ('own','any')`),
  check('work_center_control_grant_distinct_ck', sql`${t.sourceWorkCenterId} <> ${t.targetWorkCenterId}`),
]);
export type WorkCenterControlGrant = typeof workCenterControlGrant.$inferSelect;
