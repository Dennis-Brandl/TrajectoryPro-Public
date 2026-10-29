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

// Spec 2026-10-09 §8.1/§12: uploaded Pilot logos, keyed by the content hash of the stored
// (cleaned) bytes. Mirrors workflow_image. P3b uploads, cleans and serves them; P3a only
// creates the table so a theme can never reference a logo that does not exist (§11).
import { pgTable, text, integer, timestamp, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const brandAsset = pgTable('brand_asset', {
  id: text('id').primaryKey(), // 'sha256:<64 hex>'
  mime: text('mime').notNull(),
  dataBase64: text('data_base64').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('brand_asset_mime_ck', sql`${t.mime} in ('image/svg+xml','image/png')`),
  check('brand_asset_id_ck', sql`${t.id} ~ '^sha256:[0-9a-f]{64}$'`),
]);

export type BrandAsset = typeof brandAsset.$inferSelect;
