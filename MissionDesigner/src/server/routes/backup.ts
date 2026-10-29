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

import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { Context, Next } from 'hono'
import { createHmac } from 'node:crypto'
import JSZip from 'jszip'
import { auth } from '../lib/auth'
import { db, withTransaction } from '../lib/db'
import {
  user,
  team,
  userTeam,
  role,
  roleRight,
  userTeamRole,
  appSetting,
  library,
  specification,
  imageBlob,
  image,
  imageReference,
  proxyReference,
  libraryEnvironment,
  specificationEnvironment,
} from '../db/schema'
import { BACKUP_FORMAT_VERSION, BACKUP_TABLES, sha256Hex, type BackupBlob, type BackupV3 } from '../backup/format'
import { backupLimitError, readBackupZip, restoreV3, v3ShapeError } from '../backup/restoreV3'
import { SafeZipError } from '../packageFormat/safeZipReader'
import { MAX_BACKUP_UPLOAD_BYTES } from '../limits'

type Variables = {
  user: typeof user.$inferSelect
  session: { id: string; userId: string; token: string }
}

const backupRoutes = new Hono<{ Variables: Variables }>()

const requireAdmin = async (c: Context<{ Variables: Variables }>, next: Next) => {
  const s = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!s?.user) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const currentUser = s.user as typeof user.$inferSelect
  if (currentUser.isAdministrator !== true) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  c.set('user', currentUser)
  c.set('session', s.session as Variables['session'])
  await next()
}

backupRoutes.use('/backup/*', requireAdmin)
backupRoutes.use('/backup', requireAdmin)

/**
 * Known fields per table for schema-tolerant restore.
 * Keys are column names, values are defaults for missing fields.
 */
const USER_FIELDS: Record<string, unknown> = {
  id: '',
  name: null,
  email: '',
  emailVerified: null,
  image: null,
  isAdministrator: false,
  createdAt: null,
  updatedAt: null,
}

const LIBRARY_FIELDS: Record<string, unknown> = {
  id: '',
  parentLibraryId: null,
  name: '',
  entityType: 'workflow',
  description: null,
  author: null,
  changeHistory: null,
  version: '1.0.0',
  environmentLibraryIds: null,
  createdAt: 0,
  updatedAt: 0,
  lastEditedByUserId: null,
  teamId: null,
  createdByUserId: null,
}

const SPECIFICATION_FIELDS: Record<string, unknown> = {
  id: '',
  libraryId: '',
  name: '',
  description: null,
  typeName: null,
  data: {},
  environmentLibraryIds: null,
  createdAt: 0,
  updatedAt: 0,
}

/**
 * Filter a record through known fields: drop unknown keys, default missing keys.
 */
function filterFields(record: Record<string, unknown>, knownFields: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, defaultValue] of Object.entries(knownFields)) {
    result[key] = key in record ? record[key] : defaultValue
  }
  return result
}

/**
 * Compute HMAC-SHA256 signature over a string using BETTER_AUTH_SECRET.
 */
function signBackup(content: string): string {
  const secret = process.env.BETTER_AUTH_SECRET || 'dev-only-insecure-key'
  return createHmac('sha256', secret).update(content).digest('hex')
}

/**
 * Verify HMAC-SHA256 signature of a backup.
 */
function verifyBackupSignature(content: string, signature: string): boolean {
  const expected = signBackup(content)
  // Constant-time comparison to prevent timing attacks
  if (expected.length !== signature.length) return false
  let result = 0
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  return result === 0
}

/**
 * Reconstitute images from ZIP files back into data.images as data URIs.
 */
async function reconstituteImages(zip: JSZip, specId: string, data: Record<string, unknown>): Promise<void> {
  const imageIndex = data.images as Record<string, string> | undefined
  if (!imageIndex || typeof imageIndex !== 'object') return

  const reconstituted: Record<string, string> = {}

  for (const [filename, mimeType] of Object.entries(imageIndex)) {
    const zipPath = `images/${specId}/${filename}`
    const file = zip.file(zipPath)
    if (file) {
      const base64 = await file.async('base64')
      reconstituted[filename] = `data:${mimeType};base64,${base64}`
    }
  }

  data.images = Object.keys(reconstituted).length > 0 ? reconstituted : undefined
}

/** Spec data that is not a JSON object (corrupt text) travels as its raw string, so nothing is lost or invented. */
function exportSpecData(raw: string): Record<string, unknown> | string {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed !== null && typeof parsed === 'object') return parsed as Record<string, unknown>
  } catch {
    /* fall through to the raw text */
  }
  return raw
}

const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`

/** The 413 body for a backup file past the upload cap (export too big, or an upload the restore would refuse). */
function backupTooLargeBody(message: string) {
  return { error: 'backup_too_large', code: 'backup_too_large', message }
}

/** Message when the finished zip is larger than the restore routes accept; null when it fits. */
export function backupFileSizeError(zipBytes: number, cap: number = MAX_BACKUP_UPLOAD_BYTES): string | null {
  if (zipBytes <= cap) return null
  return `This Designer holds more than a backup can restore (the backup file is ${mb(zipBytes)}, the limit is ${mb(cap)}). Contact support or remove unused images first.`
}

const oversizedUpload = bodyLimit({
  maxSize: MAX_BACKUP_UPLOAD_BYTES,
  onError: (c) =>
    c.json(
      backupTooLargeBody(
        `This backup file is larger than the Designer can restore (the limit is ${mb(MAX_BACKUP_UPLOAD_BYTES)}).`,
      ),
      413,
    ),
})

// GET /api/backup - Export every Designer table as a v3 ZIP
backupRoutes.get('/backup', async (c) => {
  // One read-only snapshot: a row created mid-export can never show up without the rows it depends on.
  const { blobRows, tables } = await db.transaction(
    async (tx) => {
      const users = await tx
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          emailVerified: user.emailVerified,
          image: user.image,
          isAdministrator: user.isAdministrator,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        })
        .from(user)

      const specifications = await tx.select().from(specification)
      const blobRows = await tx.select().from(imageBlob)

      const tables: BackupV3['tables'] = {
        user: users,
        team: await tx.select().from(team),
        user_team: await tx.select().from(userTeam),
        role: await tx.select().from(role),
        role_right: await tx.select().from(roleRight),
        user_team_role: await tx.select().from(userTeamRole),
        app_setting: await tx.select().from(appSetting),
        library: await tx.select().from(library),
        specification: specifications.map((spec) => ({ ...spec, data: exportSpecData(spec.data) })),
        image: await tx.select().from(image),
        image_reference: await tx.select().from(imageReference),
        proxy_reference: await tx.select().from(proxyReference),
        library_environment: await tx.select().from(libraryEnvironment),
        specification_environment: await tx.select().from(specificationEnvironment),
      }
      return { blobRows, tables }
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )

  const zip = new JSZip()
  const blobs: BackupBlob[] = []
  for (const row of blobRows) {
    const bytes = new Uint8Array(row.data)
    const entry = `blobs/${row.contentHash}`
    zip.file(entry, bytes)
    blobs.push({
      id: row.contentHash,
      entry,
      sha256: sha256Hex(bytes),
      byteLength: bytes.byteLength,
      mimeType: row.mimeType,
      createdAt: row.createdAt,
      refCount: row.refCount,
    })
  }

  const backupJson: BackupV3 = {
    version: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    tables,
    blobs,
  }
  const backupJsonText = JSON.stringify(backupJson, null, 2)
  // Never hand out a backup this Designer could not restore.
  const tooLarge = backupLimitError(
    blobs.length + 2,
    Buffer.byteLength(backupJsonText),
    blobs.map((b) => b.byteLength),
  )
  if (tooLarge) {
    return c.json(
      backupTooLargeBody(
        `This Designer holds more than a backup can restore (${tooLarge}). Contact support or remove unused images first.`,
      ),
      413,
    )
  }
  zip.file('backup.json', backupJsonText)
  zip.file('signature.json', JSON.stringify({ algorithm: 'hmac-sha256', signature: signBackup(backupJsonText) }))

  const zipBuffer = await zip.generateAsync({ type: 'uint8array' })
  // The restore routes refuse uploads past the cap, so a bigger file would be a backup nobody can restore.
  const sizeError = backupFileSizeError(zipBuffer.byteLength)
  if (sizeError) return c.json(backupTooLargeBody(sizeError), 413)

  return new Response(zipBuffer as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="trajectory-backup-${new Date().toISOString().slice(0, 10)}.bpbackup"`,
    },
  })
})

type LoadedBackup = {
  zip: JSZip
  body: Record<string, unknown>
  signature: 'match' | 'mismatch'
  /** Set for version 3 files: the document and its blob bytes keyed by blob id. */
  v3?: { backup: BackupV3; blobBytes: Map<string, Uint8Array>; warnings: string[] }
}

/**
 * Reads, parses and checks a backup upload (shared by inspect and restore). Returns the loaded
 * backup or the error response. A missing signature.json is refused; a signature from another
 * install, or a v3 image whose bytes no longer match its recorded hash, is a mismatch.
 */
async function loadBackup(c: Context<{ Variables: Variables }>): Promise<LoadedBackup | Response> {
  let zip: JSZip
  try {
    zip = await readBackupZip(new Uint8Array(await c.req.arrayBuffer()))
  } catch (err) {
    if (!(err instanceof SafeZipError)) throw err
    if (err.code === 'json_envelope_invalid') {
      return c.json({ error: 'Invalid backup file: not a valid ZIP archive' }, 400)
    }
    const status =
      err.code === 'zip_entry_too_large' || err.code === 'zip_total_too_large' || err.code === 'zip_too_many_entries'
        ? 413
        : 422
    return c.json({ error: 'Invalid backup file: it is too large or has too many entries', code: err.code }, status)
  }

  const backupJsonFile = zip.file('backup.json')
  if (!backupJsonFile) {
    return c.json({ error: 'Invalid backup file: missing backup.json' }, 400)
  }

  let body: Record<string, unknown>
  let jsonText: string
  try {
    jsonText = await backupJsonFile.async('string')
    body = JSON.parse(jsonText) as Record<string, unknown>
  } catch {
    return c.json({ error: 'Invalid backup file: backup.json is not valid JSON' }, 400)
  }

  if (!body || ![1, 2, BACKUP_FORMAT_VERSION].includes(body.version as number)) {
    return c.json({ error: 'unsupported_backup_version' }, 422)
  }

  // A missing, empty or unreadable signature.json is no signature at all and is refused.
  let recorded: string | null = null
  try {
    const sigText = await zip.file('signature.json')?.async('string')
    const sigData = sigText ? (JSON.parse(sigText) as { signature?: unknown }) : null
    if (sigData && typeof sigData.signature === 'string' && sigData.signature) recorded = sigData.signature
  } catch {
    recorded = null
  }
  if (!recorded) {
    return c.json(
      {
        error:
          'Invalid backup file: missing signature. This backup may be from an older version or has been tampered with.',
      },
      422,
    )
  }
  let signature: LoadedBackup['signature'] = verifyBackupSignature(jsonText, recorded) ? 'match' : 'mismatch'

  if (body.version !== BACKUP_FORMAT_VERSION) return { zip, body, signature }

  const shapeError = v3ShapeError(body)
  if (shapeError) return c.json({ error: `Invalid backup file: ${shapeError}` }, 422)
  const backup = body as unknown as BackupV3
  const blobBytes = new Map<string, Uint8Array>()
  const warnings: string[] = []
  for (const blob of backup.blobs) {
    const entry = zip.file(blob.entry)
    if (!entry) return c.json({ error: `Invalid backup file: missing ${blob.entry}` }, 422)
    let bytes: Uint8Array
    try {
      bytes = await entry.async('uint8array')
    } catch {
      return c.json({ error: `Invalid backup file: ${blob.entry} is corrupted` }, 422)
    }
    if (sha256Hex(bytes) !== blob.sha256) {
      signature = 'mismatch'
      warnings.push(`Image ${blob.entry} does not match its recorded hash`)
    }
    blobBytes.set(blob.id, bytes)
  }
  return { zip, body, signature, v3: { backup, blobBytes, warnings } }
}

// POST /api/backup/inspect - Report a backup's version, signature and row counts without changing anything
backupRoutes.post('/backup/inspect', oversizedUpload, async (c) => {
  const loaded = await loadBackup(c)
  if (loaded instanceof Response) return loaded
  const { body, signature, v3 } = loaded
  const counts: Record<string, number> = {}
  if (v3) {
    for (const t of BACKUP_TABLES) counts[t] = v3.backup.tables[t]?.length ?? 0
    counts.image_blob = v3.backup.blobs.length
  } else {
    const length = (v: unknown) => (Array.isArray(v) ? v.length : 0)
    counts.user = length(body.users)
    counts.library = length(body.libraries)
    counts.specification = length(body.specifications)
  }
  return c.json({ version: body.version as number, signature, counts })
})

// POST /api/backup/restore - Import data from ZIP. A mismatching signature needs ?acceptForeignSignature=1.
backupRoutes.post('/backup/restore', oversizedUpload, async (c) => {
  const currentUser = c.get('user')

  const loaded = await loadBackup(c)
  if (loaded instanceof Response) return loaded
  const { zip, body, signature, v3 } = loaded
  if (signature === 'mismatch' && c.req.query('acceptForeignSignature') !== '1') {
    return c.json({ error: 'signature_mismatch' }, 409)
  }

  if (v3) {
    const warnings = [...v3.warnings]
    try {
      const counts = await withTransaction((q) => restoreV3(q, v3.backup, v3.blobBytes, currentUser.id, warnings))
      return c.json({ success: true, version: body.version as number, counts, warnings })
    } catch (err) {
      console.error('[backup restore] transaction failed:', err)
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: `Restore failed and nothing was changed: ${message}` }, 500)
    }
  }

  const warnings: string[] = []

  const backupUsers = (body.users ?? []) as Record<string, unknown>[]
  const backupLibraries = (body.libraries ?? []) as Record<string, unknown>[]
  const backupSpecifications = (body.specifications ?? []) as Record<string, unknown>[]

  const filteredUsers = backupUsers.map((u) => {
    const filtered = filterFields(u, USER_FIELDS)
    const unknownKeys = Object.keys(u).filter((k) => !(k in USER_FIELDS))
    if (unknownKeys.length > 0) {
      warnings.push(`User ${u.email}: skipped unknown fields: ${unknownKeys.join(', ')}`)
    }
    return filtered
  })

  const filteredLibraries = backupLibraries.map((lib) => {
    const filtered = filterFields(lib, LIBRARY_FIELDS)
    const unknownKeys = Object.keys(lib).filter((k) => !(k in LIBRARY_FIELDS))
    if (unknownKeys.length > 0) {
      warnings.push(`Library ${lib.name}: skipped unknown fields: ${unknownKeys.join(', ')}`)
    }
    return filtered
  })

  const filteredSpecs = backupSpecifications.map((spec) => {
    const filtered = filterFields(spec, SPECIFICATION_FIELDS)
    const unknownKeys = Object.keys(spec).filter((k) => !(k in SPECIFICATION_FIELDS))
    if (unknownKeys.length > 0) {
      warnings.push(`Specification ${spec.name}: skipped unknown fields: ${unknownKeys.join(', ')}`)
    }
    return filtered
  })

  // Reconstitute images from ZIP into specification data
  for (const spec of filteredSpecs) {
    const data = spec.data as Record<string, unknown>
    await reconstituteImages(zip, spec.id as string, data)
  }

  let restoredUserCount = filteredUsers.length
  await withTransaction(async (q) => {
    // A backup id held here under another email (case-insensitive) is a different person. The
    // signed-in admin's id is never handed over; any other such local account goes with its
    // sessions and credentials, and the backup user is inserted without a password.
    const sameEmail = (a: unknown, b: unknown) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase()
    const localEmail = new Map<string, string>()
    const ids = filteredUsers.map((u) => String(u.id))
    if (ids.length > 0) {
      const local = await q<{ id: string; email: string }>('SELECT "id","email" FROM "user" WHERE "id" = ANY($1)', [
        ids,
      ])
      for (const r of local) localEmail.set(r.id, r.email)
    }
    const foreignIds = new Set<string>()
    const restoredUsers = filteredUsers.filter((u) => {
      const id = String(u.id)
      if (!localEmail.has(id) || sameEmail(localEmail.get(id), u.email)) return true
      if (id === currentUser.id) {
        warnings.push(`User ${String(u.email)}: not restored — its id belongs to the signed-in administrator here.`)
        return false
      }
      foreignIds.add(id)
      warnings.push(
        `User ${String(u.email)}: restored without a password (its id belonged to a different account here). Set a password in Admin → Accounts.`,
      )
      return true
    })
    restoredUserCount = restoredUsers.length

    await q('DELETE FROM "specification"')
    await q('DELETE FROM "library"')

    // currentUser.id is always included — array is never empty, so NOT IN is always safe.
    const backupUserIds = restoredUsers.map((u) => u.id as string).filter((id) => !foreignIds.has(id))
    const usersToKeep = [...new Set([...backupUserIds, currentUser.id])]
    const placeholders = usersToKeep.map((_, i) => `$${i + 1}`).join(', ')
    await q(`DELETE FROM "session" WHERE "userId" NOT IN (${placeholders})`, usersToKeep)
    await q(`DELETE FROM "account" WHERE "userId" NOT IN (${placeholders})`, usersToKeep)
    await q(`DELETE FROM "user" WHERE "id" NOT IN (${placeholders})`, usersToKeep)

    for (const u of restoredUsers) {
      // The same person kept under their id (whatever the email's case), else a match by email.
      const [existing] = await q<{ id: string }>(
        'SELECT "id" FROM "user" WHERE "id" = $1 OR "email" = $2 ORDER BY ("id" = $1) DESC LIMIT 1',
        [u.id as string, u.email as string],
      )
      if (existing) {
        // The signed-in administrator is never changed by a restore.
        if (existing.id === currentUser.id) continue
        await q(`UPDATE "user" SET "name" = $1, "isAdministrator" = $2 WHERE "id" = $3`, [
          (u.name as string | null) ?? null,
          !!(u.isAdministrator ?? false),
          existing.id,
        ])
      } else {
        // Support both old SQLite epoch-ms numbers and new Postgres ISO-string exports.
        const createdAt = u.createdAt != null ? new Date(u.createdAt as string | number) : new Date()
        const updatedAt = u.updatedAt != null ? new Date(u.updatedAt as string | number) : new Date()
        await q(
          `INSERT INTO "user" ("id", "name", "email", "emailVerified", "image", "isAdministrator", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            u.id as string,
            (u.name as string | null) ?? null,
            u.email as string,
            u.emailVerified != null ? !!u.emailVerified : null,
            (u.image as string | null) ?? null,
            !!(u.isAdministrator ?? false),
            createdAt,
            updatedAt,
          ],
        )
      }
    }

    // Column set matches the post-slice-6b team-model schema (no userId/forkedFrom*/isShared).
    // This slice ships atomically; restore runs against the schema created by the
    // slice's DDL flip, not the transitional half-migrated state.
    for (const lib of filteredLibraries) {
      await q(
        `INSERT INTO "library" (
          "id", "parentLibraryId", "name", "entityType",
          "description", "author", "changeHistory", "version", "environmentLibraryIds",
          "createdAt", "updatedAt",
          "lastEditedByUserId", "teamId", "createdByUserId"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          lib.id as string,
          (lib.parentLibraryId as string) ?? null,
          lib.name as string,
          lib.entityType as string,
          (lib.description as string) ?? null,
          (lib.author as string) ?? null,
          (lib.changeHistory as string) ?? null,
          (lib.version as string) ?? '1.0.0',
          lib.environmentLibraryIds ? JSON.stringify(lib.environmentLibraryIds) : null,
          lib.createdAt as number,
          lib.updatedAt as number,
          (lib.lastEditedByUserId as string) ?? null,
          (lib.teamId as string) ?? null,
          (lib.createdByUserId as string) ?? null,
        ],
      )
    }

    for (const spec of filteredSpecs) {
      await q(
        `INSERT INTO "specification" ("id", "libraryId", "name", "description", "typeName", "data", "environmentLibraryIds", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          spec.id as string,
          spec.libraryId as string,
          spec.name as string,
          (spec.description as string) ?? null,
          (spec.typeName as string) ?? null,
          JSON.stringify(spec.data),
          spec.environmentLibraryIds ? JSON.stringify(spec.environmentLibraryIds) : null,
          spec.createdAt as number,
          spec.updatedAt as number,
        ],
      )
    }
  })

  return c.json({
    success: true,
    version: body.version as number,
    counts: {
      users: restoredUserCount,
      libraries: filteredLibraries.length,
      specifications: filteredSpecs.length,
    },
    warnings: warnings.length > 0 ? warnings : undefined,
  })
})

// POST /api/backup/clear-workflows - Delete all libraries and specifications but keep users
backupRoutes.post('/backup/clear-workflows', async (c) => {
  const counts = await withTransaction(async (q) => {
    const specRows = await q<{ id: string }>('DELETE FROM "specification" RETURNING "id"')
    const libRows = await q<{ id: string }>('DELETE FROM "library" RETURNING "id"')
    return { specifications: specRows.length, libraries: libRows.length }
  })

  return c.json({ success: true, counts })
})

// POST /api/backup/clear - Delete ALL data (preserves current admin user, their sessions and accounts)
backupRoutes.post('/backup/clear', async (c) => {
  const currentUser = c.get('user')
  await withTransaction(async (q) => {
    await q('DELETE FROM "specification"')
    await q('DELETE FROM "library"')
    // Preserve current admin's sessions and accounts
    await q(`DELETE FROM "session" WHERE "userId" != $1`, [currentUser.id])
    await q(`DELETE FROM "account" WHERE "userId" != $1`, [currentUser.id])
    await q(`DELETE FROM "user" WHERE "id" != $1`, [currentUser.id])
  })

  return c.json({ success: true })
})

export { backupRoutes }
