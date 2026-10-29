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

import { createHash } from 'node:crypto'

/** Backup format version written by GET /api/backup. */
export const BACKUP_FORMAT_VERSION = 3

/** Every Designer table a v3 backup carries, in FK-safe insert order (parents first). */
export const BACKUP_TABLES = [
  'user',
  'team',
  'user_team',
  'role',
  'role_right',
  'user_team_role',
  'app_setting',
  'library',
  'specification',
  'image',
  'image_reference',
  'proxy_reference',
  'library_environment',
  'specification_environment',
] as const

export type BackupTable = (typeof BACKUP_TABLES)[number]

/**
 * One image_blob row minus its bytes. The bytes are the zip entry `blobs/<id>`; `id` is the
 * contentHash and `byteLength` is byteSize. `mimeType`, `createdAt` and `refCount` use the drizzle
 * names. The restore inserts refCount 0 and lets the trigger count, so the exported refCount is
 * informational.
 */
export type BackupBlob = {
  id: string
  entry: string
  sha256: string
  byteLength: number
  mimeType: string
  createdAt: number
  refCount: number
}

/**
 * Row keys are the drizzle property names (camelCase, e.g. "teamId"), not the SQL column names,
 * for every table. The restore inserts using the same names.
 * `image_blob` rows are not listed under `tables`; their bytes live in `blobs`/zip entries, and
 * `image.contentHash` links an image to its blob. `specification.data` is the parsed JSON object (or the raw text when the stored value was not valid JSON).
 */
export type BackupV3 = {
  version: 3
  exportedAt: string
  tables: { [T in BackupTable]: Record<string, unknown>[] }
  blobs: BackupBlob[]
}

/** User columns exported (never password hashes, sessions, accounts or verification tokens). */
export const USER_EXPORT_FIELDS = [
  'id',
  'name',
  'email',
  'emailVerified',
  'image',
  'isAdministrator',
  'createdAt',
  'updatedAt',
] as const

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
