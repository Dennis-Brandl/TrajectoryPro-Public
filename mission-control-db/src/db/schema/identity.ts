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

import { pgTable, uuid, text, timestamp, boolean, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const appUser = pgTable('app_user', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  /** Short unique identifier operators type on e-signatures (spec 2026-09-06 D6). '' is a
   *  sentinel: the 0031 BEFORE INSERT trigger app_user_login_name_default replaces it with a
   *  name derived from the email, so every insert path — better-auth sign-up included —
   *  satisfies NOT NULL and the pattern CHECK without naming the column. Never persists. */
  loginName: text('login_name').notNull().unique().default(''),
  displayName: text('display_name').notNull(),
  status: text('status').notNull().default('active'),
  accessLevel: text('access_level').notNull().default('viewer'),
  // better-auth admin-plugin columns. `role` is DERIVED from access_level (mirror in
  // dao/access.ts setAccessLevel) — never written independently. The three ban columns
  // are required by the plugin's schema but unused: `status` is the disable mechanism.
  role: text('role').notNull().default('user'),
  banned: boolean('banned'),
  banReason: text('ban_reason'),
  banExpires: timestamp('ban_expires', { withTimezone: true }),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('app_user_status_ck', sql`${t.status} in ('active','disabled')`),
  check('app_user_access_level_ck', sql`${t.accessLevel} in ('administrator','steward','viewer')`),
  check('app_user_login_name_ck', sql`${t.loginName} ~ '^[a-z0-9][a-z0-9._-]{1,63}$'`),
]);

export const role = pgTable('role', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  description: text('description'),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AppUser = typeof appUser.$inferSelect;
export type NewAppUser = typeof appUser.$inferInsert;
export type Role = typeof role.$inferSelect;
export type NewRole = typeof role.$inferInsert;
