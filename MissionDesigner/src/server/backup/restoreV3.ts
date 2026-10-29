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

import { randomUUID } from 'node:crypto'
import type JSZip from 'jszip'
import { getTableColumns, type Table } from 'drizzle-orm'
import { GLOBAL_TEAM_ID } from '@/lib/global-team'
import { ROLE_SEEDS } from '../authz/rights'
import {
  team,
  userTeam,
  role,
  roleRight,
  userTeamRole,
  appSetting,
  library,
  specification,
  image,
  imageReference,
  proxyReference,
  libraryEnvironment,
  specificationEnvironment,
} from '../db/schema'
import { ALLOWED_IMAGE_MIMES, sniffMime } from '../imageMime'
import { MAX_BACKUP_ENTRIES, MAX_BACKUP_INFLATED_BYTES, MAX_BACKUP_JSON_BYTES, MAX_IMAGE_BYTES } from '../limits'
import { readBudgetedZip } from '../packageFormat/safeZipReader'
import { BACKUP_TABLES, USER_EXPORT_FIELDS, sha256Hex, type BackupTable, type BackupV3 } from './format'

type Q = <R = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>

/** Name of the entry that holds the backup document. */
const BACKUP_JSON_ENTRY = 'backup.json'

/** The limits a backup must fit to be restorable; the export checks the same ones. */
export type BackupLimits = { entries: number; totalBytes: number; jsonBytes: number; blobBytes: number }

export const BACKUP_LIMITS: BackupLimits = {
  entries: MAX_BACKUP_ENTRIES,
  totalBytes: MAX_BACKUP_INFLATED_BYTES,
  jsonBytes: MAX_BACKUP_JSON_BYTES,
  blobBytes: MAX_IMAGE_BYTES,
}

/**
 * Returns why a backup of this shape could not be restored, or null when it fits. `entries`
 * counts every zip entry, `blobSizes` the byte size of each blobs/* entry.
 */
export function backupLimitError(
  entries: number,
  jsonBytes: number,
  blobSizes: number[],
  limits: BackupLimits = BACKUP_LIMITS,
): string | null {
  const mb = (n: number) => `${Math.round(n / (1024 * 1024))} MB`
  if (entries > limits.entries) return `${entries} files, the limit is ${limits.entries}`
  if (jsonBytes > limits.jsonBytes) return `${mb(jsonBytes)} of data, the limit is ${mb(limits.jsonBytes)}`
  const largest = Math.max(0, ...blobSizes)
  if (largest > limits.blobBytes) return `an image of ${mb(largest)}, the limit is ${mb(limits.blobBytes)}`
  const total = jsonBytes + blobSizes.reduce((a, b) => a + b, 0)
  if (total > limits.totalBytes) return `${mb(total)} in all, the limit is ${mb(limits.totalBytes)}`
  return null
}

/**
 * Opens a backup archive within the backup limits. Every entry is inflated under its byte budget
 * (backup.json: jsonBytes, blobs/*: blobBytes, anything else: the total), so an archive that
 * misstates its sizes is stopped partway rather than inflated whole.
 */
export function readBackupZip(bytes: Uint8Array, limits: BackupLimits = BACKUP_LIMITS): Promise<JSZip> {
  return readBudgetedZip(bytes, {
    entries: limits.entries,
    totalBytes: limits.totalBytes,
    entryBytes: (name) =>
      name === BACKUP_JSON_ENTRY ? limits.jsonBytes : name.startsWith('blobs/') ? limits.blobBytes : limits.totalBytes,
  })
}

/** Returns an error message when `body` is not a well-formed v3 backup document. */
export function v3ShapeError(body: Record<string, unknown>): string | null {
  const tables = body.tables
  if (!tables || typeof tables !== 'object' || Array.isArray(tables)) return 'tables is missing'
  for (const t of BACKUP_TABLES) {
    const rows = (tables as Record<string, unknown>)[t]
    if (rows === undefined) continue
    if (!Array.isArray(rows) || rows.some((r) => !r || typeof r !== 'object' || Array.isArray(r))) {
      return `tables.${t} is not a list of rows`
    }
  }
  if (!Array.isArray(body.blobs)) return 'blobs is missing'
  for (const b of body.blobs as unknown[]) {
    const blob = b as Record<string, unknown> | null
    if (
      !blob ||
      typeof blob.id !== 'string' ||
      typeof blob.entry !== 'string' ||
      !blob.entry.startsWith('blobs/') ||
      typeof blob.sha256 !== 'string' ||
      typeof blob.mimeType !== 'string'
    ) {
      return 'blobs has an invalid entry'
    }
  }
  return null
}

const TABLE_OBJECTS: Record<Exclude<BackupTable, 'user'>, Table> = {
  team,
  user_team: userTeam,
  role,
  role_right: roleRight,
  user_team_role: userTeamRole,
  app_setting: appSetting,
  library,
  specification,
  image,
  image_reference: imageReference,
  proxy_reference: proxyReference,
  library_environment: libraryEnvironment,
  specification_environment: specificationEnvironment,
}

/** Columns that hold a user id; remapped when a backup user becomes the restoring admin or gets a new id. */
const USER_REF_COLUMNS = ['userId', 'lastEditedByUserId', 'createdByUserId']

function knownColumns(table: BackupTable): Set<string> {
  if (table === 'user') return new Set(USER_EXPORT_FIELDS)
  return new Set(Object.keys(getTableColumns(TABLE_OBJECTS[table])))
}

/** Orders rows so every row comes after the rows its `deps` name (parents first). */
function parentsFirst(
  rows: Record<string, unknown>[],
  deps: (row: Record<string, unknown>) => unknown[],
): Record<string, unknown>[] {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const seen = new Set<unknown>()
  const out: Record<string, unknown>[] = []
  const visit = (row: Record<string, unknown>) => {
    if (seen.has(row.id)) return
    seen.add(row.id)
    for (const dep of deps(row)) {
      const parent = dep !== row.id ? byId.get(dep) : undefined
      if (parent) visit(parent)
    }
    out.push(row)
  }
  for (const row of rows) visit(row)
  return out
}

/**
 * Replaces the Designer's content with a v3 backup inside the caller's transaction. Keeps
 * `keepAdminId` (never overwritten) with their sessions, the seeded roles and the GLOBAL team
 * (both upserted from the backup). A backup user whose id and email (case-insensitive) both
 * match a local user is upserted by id, so the password survives; a local user whose id is in
 * the backup under another email is a different person and goes with its sessions and
 * credentials, the same as every user not in the backup. A backup user with the kept admin's id
 * but another email gets a new id. A backup user with the kept admin's email is merged into the
 * kept admin. Returns the rows written per table.
 */
export async function restoreV3(
  tx: Q,
  backup: BackupV3,
  blobBytes: Map<string, Uint8Array>,
  keepAdminId: string,
  warnings: string[] = [],
): Promise<Record<BackupTable | 'image_blob', number>> {
  const counts = Object.fromEntries([...BACKUP_TABLES, 'image_blob'].map((t) => [t, 0])) as Record<
    BackupTable | 'image_blob',
    number
  >

  // Keep only known columns, so a newer file's extra columns cannot break the insert.
  const tables = {} as Record<BackupTable, Record<string, unknown>[]>
  for (const t of BACKUP_TABLES) {
    const known = knownColumns(t)
    const skipped = new Set<string>()
    tables[t] = (backup.tables[t] ?? []).map((row) => {
      const kept: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(row)) {
        if (known.has(k)) kept[k] = v
        else skipped.add(k)
      }
      return kept
    })
    if (skipped.size > 0) warnings.push(`${t}: skipped unknown columns: ${[...skipped].join(', ')}`)
  }

  const sameEmail = (a: unknown, b: unknown) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase()
  const differentAccount = (email: unknown) =>
    `User ${String(email)}: restored without a password (its id belonged to a different account here). Set a password in Admin → Accounts.`
  const rewriteUserRefs = (remap: Map<unknown, string>) => {
    for (const t of BACKUP_TABLES) {
      for (const row of tables[t]) {
        for (const col of USER_REF_COLUMNS) if (remap.has(row[col])) row[col] = remap.get(row[col])
      }
    }
  }
  const warnedIds = new Set<string>()

  // Who holds each backup user id here, so an id is kept only for the same person.
  const localEmail = new Map<string, string>()
  const backupIds = tables.user.map((u) => String(u.id))
  if (backupIds.length > 0) {
    const local = await tx<{ id: string; email: string }>('SELECT "id","email" FROM "user" WHERE "id" = ANY($1)', [
      backupIds,
    ])
    for (const r of local) localEmail.set(r.id, r.email)
  }

  // The signed-in admin's id under another email is a different person: give them a new id.
  const [admin] = await tx<{ email: string }>('SELECT "email" FROM "user" WHERE "id" = $1', [keepAdminId])
  for (const u of tables.user) {
    if (u.id === keepAdminId && admin && !sameEmail(u.email, admin.email)) {
      const newId = randomUUID()
      rewriteUserRefs(new Map([[keepAdminId, newId]]))
      u.id = newId
      warnings.push(differentAccount(u.email))
      warnedIds.add(newId)
    }
  }

  // A backup user with the restoring admin's email (a fresh install's admin) is that admin.
  const remap = new Map<unknown, string>()
  for (const u of tables.user) {
    if (u.id !== keepAdminId && admin && sameEmail(u.email, admin.email)) {
      remap.set(u.id, keepAdminId)
      warnings.push(`User ${admin.email} in the backup was merged into the signed-in administrator`)
    }
  }
  if (remap.size > 0) {
    rewriteUserRefs(remap)
    tables.user = tables.user.filter((u) => !remap.has(u.id))
  }

  // Any other backup id held here by another email is a different person: the local account goes
  // (with its sessions and credentials) and the backup user arrives with no password.
  const foreignIds = new Set<string>()
  for (const u of tables.user) {
    const id = String(u.id)
    if (id === keepAdminId || !localEmail.has(id) || sameEmail(localEmail.get(id), u.email)) continue
    foreignIds.add(id)
    warnings.push(differentAccount(u.email))
    warnedIds.add(id)
  }

  // Delete the current content, children first.
  const seededRoleIds = ROLE_SEEDS.map((r) => r.id)
  const keptUserIds = [
    ...new Set([keepAdminId, ...tables.user.map((u) => String(u.id)).filter((id) => !foreignIds.has(id))]),
  ]
  await tx('DELETE FROM "proxy_reference"')
  await tx('DELETE FROM "specification_environment"')
  await tx('DELETE FROM "library_environment"')
  await tx('DELETE FROM "image_reference"')
  await tx('DELETE FROM "image"') // the refcount trigger drops each blob as its last image goes
  await tx('DELETE FROM "image_blob"')
  await tx('DELETE FROM "specification"')
  await tx('DELETE FROM "library"')
  await tx('DELETE FROM "user_team_role"')
  await tx('DELETE FROM "role_right"')
  await tx('DELETE FROM "role" WHERE NOT ("id" = ANY($1))', [seededRoleIds])
  await tx('DELETE FROM "user_team"')
  await tx('DELETE FROM "team" WHERE "id" <> $1', [GLOBAL_TEAM_ID])
  await tx('DELETE FROM "app_setting"')
  // Sessions and accounts go with their user (ON DELETE CASCADE).
  await tx('DELETE FROM "user" WHERE NOT ("id" = ANY($1))', [keptUserIds])

  const insert = async (t: BackupTable, row: Record<string, unknown>, conflict: string) => {
    const cols = Object.keys(row)
    const values = cols.map((c) => {
      const v = row[c]
      return t === 'specification' && c === 'data' && typeof v !== 'string' ? JSON.stringify(v) : v
    })
    const quoted = cols.map((c) => `"${c}"`)
    const rows = await tx(
      `INSERT INTO "${t}" (${quoted.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) ${conflict} RETURNING 1`,
      values,
    )
    counts[t] += rows.length
  }
  const upsert = (row: Record<string, unknown>, key: string) => {
    const set = Object.keys(row)
      .filter((c) => c !== key)
      .map((c) => `"${c}" = EXCLUDED."${c}"`)
    return set.length > 0 ? `ON CONFLICT ("${key}") DO UPDATE SET ${set.join(', ')}` : 'ON CONFLICT DO NOTHING'
  }

  for (const u of tables.user) {
    if (u.id === keepAdminId) {
      counts.user += 1
      continue
    }
    await insert('user', u, upsert(u, 'id'))
  }
  for (const r of tables.team) await insert('team', r, upsert(r, 'id'))
  for (const r of tables.role) await insert('role', r, upsert(r, 'id'))
  for (const t of ['role_right', 'user_team', 'user_team_role', 'app_setting'] as const) {
    for (const r of tables[t]) await insert(t, r, 'ON CONFLICT DO NOTHING')
  }
  for (const r of parentsFirst(tables.library, (l) => [l.parentLibraryId])) await insert('library', r, '')
  const specs = parentsFirst(tables.specification, (s) => [s.parentSpecificationId, s.rootSpecificationId])
  for (const r of specs) await insert('specification', r, '')

  // Blobs start at refCount 0; the image insert trigger counts their images. The type is sniffed
  // from the bytes and the id re-derived from them, so the file can neither label active content
  // as an image nor store bytes under someone else's hash.
  const blobType = new Map<unknown, string>()
  const blobHash = new Map<unknown, string>()
  const skippedBlobs = new Set<unknown>()
  for (const blob of backup.blobs) {
    const bytes = blobBytes.get(blob.id)
    if (!bytes) continue
    const buf = Buffer.from(bytes)
    const mimeType = sniffMime(buf)
    if (!mimeType || !ALLOWED_IMAGE_MIMES.has(mimeType)) {
      skippedBlobs.add(blob.id)
      continue
    }
    const contentHash = sha256Hex(buf)
    blobType.set(blob.id, mimeType)
    blobHash.set(blob.id, contentHash)
    await tx(
      `INSERT INTO "image_blob" ("contentHash", "data", "mimeType", "byteSize", "createdAt", "refCount")
       VALUES ($1, $2, $3, $4, $5, 0) ON CONFLICT ("contentHash") DO NOTHING`,
      [contentHash, buf, mimeType, buf.length, blob.createdAt],
    )
  }
  const skippedImages = new Set<unknown>()
  for (const id of skippedBlobs) {
    const using = tables.image.filter((img) => img.contentHash === id)
    for (const img of using) skippedImages.add(img.id)
    const names = using.length > 0 ? using.map((img) => String(img.filename ?? id)) : [String(id)]
    for (const name of names) warnings.push(`Skipped image "${name}": not a PNG, JPEG, WebP or GIF image.`)
  }
  tables.image = tables.image
    .filter((img) => !skippedImages.has(img.id))
    .map((img) =>
      blobHash.has(img.contentHash)
        ? { ...img, contentHash: blobHash.get(img.contentHash), mimeType: blobType.get(img.contentHash) }
        : img,
    )
  tables.image_reference = tables.image_reference.filter((ref) => !skippedImages.has(ref.imageId))
  for (const t of [
    'image',
    'image_reference',
    'proxy_reference',
    'library_environment',
    'specification_environment',
  ] as const) {
    for (const r of tables[t]) await insert(t, r, '')
  }
  // No blob outlives its last image.
  await tx('DELETE FROM "image_blob" WHERE "refCount" <= 0')
  const [blobCount] = await tx<{ n: number }>('SELECT COUNT(*)::int AS "n" FROM "image_blob"')
  counts.image_blob = blobCount?.n ?? 0

  // Backups carry no passwords: name every restored user who cannot sign in here yet.
  const restoredIds = tables.user.map((u) => String(u.id)).filter((id) => id !== keepAdminId && !warnedIds.has(id))
  if (restoredIds.length > 0) {
    const noPassword = await tx<{ email: string }>(
      `SELECT u."email" FROM "user" u
       WHERE u."id" = ANY($1)
         AND NOT EXISTS (SELECT 1 FROM "account" a WHERE a."userId" = u."id" AND a."providerId" = 'credential')
       ORDER BY u."email"`,
      [restoredIds],
    )
    for (const r of noPassword) {
      warnings.push(`User ${r.email}: has no password on this install. Set one in Admin → Accounts.`)
    }
  }
  return counts
}
