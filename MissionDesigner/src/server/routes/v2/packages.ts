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

// Phase 35 §2.10: import + export endpoints under /api/v2/packages.
//
// Export: GET /api/v2/packages/workflow/:rootSpecId
//   - Reads the tree via specReadDao.getTree (canRead via the DAO)
//   - Verifies the id is a root spec
//   - Builds a v3.0 file-format envelope and embeds image bytes from image_blob
//   - Streams a ZIP back to the client
//
// Import: POST /api/v2/packages/import (added in Wave C)

import { globalForbiddenEntityTypes } from '@/lib/global-team'
import { createHash, randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type JSZip from 'jszip'
import { z } from 'zod'
import { specReadDao, TreeTooLargeError } from '../../dao/specReadDao'
import { v2ErrorBody, scrubSqliteText } from '../../errors/v2'
import type { V2Session } from '../../middleware/v2/permissions'
import { loadPrincipal, canDo, canSee, editLockedStates } from '../../authz/policy'
import { buildWorkflowPackage } from '../../packageFormat/buildWorkflowPackage'
import { EXPORT_WARNINGS_HEADER, encodeExportWarnings } from '@/lib/packageFormat/export-warnings-header'
import { readTypeName } from '@/lib/packageFormat/type-name'
import { runBatchSave } from '../../batchSave'
import { readSafeZip, readSafeLibraryZip, SafeZipError } from '../../packageFormat/safeZipReader'
import { ALLOWED_IMAGE_MIMES, sniffMime } from '../../imageMime'
import { parseWorkflowEnvelope, EnvelopeParseError } from '../../packageFormat/parseEnvelope'
import { buildImportBatch } from '../../packageFormat/buildImportBatch'
import { insertImportImages, ImportImageMissingError } from '../../packageFormat/insertImportImages'
import { injectSpecImagesAsDataUris } from '../../packageFormat/injectSpecImages'
import { injectWorkflowEnvSpecIds } from '../../packageFormat/injectWorkflowEnvSpecIds'
import { injectEmbeddedWorkflowSpecIds } from '../../packageFormat/injectEmbeddedWorkflowSpecIds'
import { importLibrariesFromZip } from '../../packageFormat/importLibrariesFromZip'
import { findDanglingReferences } from '../../packageFormat/danglingReferences'
import { importActionLibrary, importEnvironmentLibrary } from '@/lib/import/library-importers'
import { importWorkflowSpecToInternal } from '@/lib/import/workflow-importers'
import { CURRENT_DATA_SCHEMA_VERSION } from '@/lib/data-schema-version'
import { db, withTransaction } from '../../lib/db'
import { Phase1Error, Phase2Error } from '../../batchSave'
import { library as libsTable, specification as specsTable } from '../../db/schema'
import { MAX_IMPORT_REQUEST_BYTES, MAX_IMPORT_ZIP_BYTES } from '../../limits'
import { ImportPreviewCache } from '../../lib/importPreviewCache'
import { buildImportPlan, type ParsedBundle, type ExistingDbState } from '../../packageFormat/buildImportPlan'
import { existingLibraryWrites } from '../../packageFormat/existingLibraryWrites'
import {
  assertReplaceUnlocked,
  LockedReplaceError,
  refuseBlockedReplaces,
  refusedReport,
} from '../../packageFormat/replaceBlockers'
import { buildEnvSpecLookup } from '../../packageFormat/envSpecLookup'
import type { ImportPlanRow, PostImportReport, WflibxEntityType } from '@/types/wflibx-import'
import { inArray, or, and, eq, sql } from 'drizzle-orm'

type Variables = { v2Session: V2Session }
/** Connection-scoped query function threaded from withTransaction. */
type Q = <R = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>

export const packagesV2 = new Hono<{ Variables: Variables }>()

packagesV2.get('/packages/workflow/:rootSpecId', async (c) => {
  const session = c.get('v2Session')
  const rootSpecId = c.req.param('rootSpecId')
  const ctx = { sessionUserId: session.userId }

  // Resolve the spec and confirm it's a root
  const spec = await specReadDao.getSpec(ctx, rootSpecId)
  if (!spec) return c.json(v2ErrorBody('not_found'), 404)
  if (spec.parentSpecificationId !== null || spec.id !== spec.rootSpecificationId) {
    return c.json(v2ErrorBody('not_found'), 404)
  }

  // Fetch the tree (canRead is enforced inside getTree)
  let tree
  try {
    tree = await specReadDao.getTree(ctx, rootSpecId)
  } catch (err) {
    if (err instanceof TreeTooLargeError) {
      return c.json(v2ErrorBody('tree_too_large', { dimension: err.dimension, count: err.count }), 413)
    }
    throw err
  }
  if (!tree) return c.json(v2ErrorBody('not_found'), 404)

  // Build the v7.0 single-workflow runtime package via the lifted exporter.
  // The runtime contract lives in TrajectoryRuntime's spec/docs/editor-export-format.md.
  const { zipBytes, safeName, warnings } = await buildWorkflowPackage({
    tree,
    ctx,
    workflowName: spec.name || 'workflow',
  })
  // The response body is the ZIP itself, so warnings ride back in one header (GATE follow-up
  // item 5). The log line stays: a scripted download never reads the header, and it is the
  // only record of an incomplete export (undecodable images, ambiguous gate bindings).
  if (warnings.length > 0) {
    console.warn(`[export] workflow "${spec.name}" (${rootSpecId}): ${warnings.join('; ')}`)
  }

  const headers: Record<string, string> = {
    'content-type': 'application/zip',
    'content-disposition': `attachment; filename="${safeName}.WFmasterX"`,
    'cache-control': 'private, no-store',
  }
  const encodedWarnings = encodeExportWarnings(warnings)
  if (encodedWarnings) headers[EXPORT_WARNINGS_HEADER] = encodedWarnings

  return new Response(Buffer.from(zipBytes), { status: 200, headers })
})

/** Refuses an upload larger than the import limit before its body is read into memory. */
const importUploadLimit = bodyLimit({
  maxSize: MAX_IMPORT_REQUEST_BYTES,
  onError: (c) => c.json(v2ErrorBody('zip_too_large', { limit: MAX_IMPORT_ZIP_BYTES }), 413),
})

/** HTTP status for a SafeZipError: 413 when a size or count limit was passed, 422 for anything else. */
function safeZipErrorStatus(err: SafeZipError): 413 | 422 {
  return err.code === 'zip_too_large' ||
    err.code === 'zip_total_too_large' ||
    err.code === 'zip_entry_too_large' ||
    err.code === 'zip_too_many_entries' ||
    err.code === 'too_many_images'
    ? 413
    : 422
}

packagesV2.post('/packages/import', importUploadLimit, async (c) => {
  const session = c.get('v2Session')
  const ctx = { sessionUserId: session.userId }

  // Multipart parse
  let form: FormData
  try {
    form = await c.req.formData()
  } catch {
    return c.json(v2ErrorBody('schema_mismatch'), 422)
  }
  const fileVal = form.get('file')
  const targetLibraryId = form.get('targetLibraryId')
  if (!(fileVal instanceof File)) return c.json(v2ErrorBody('schema_mismatch', { field: 'file' }), 422)
  if (typeof targetLibraryId !== 'string' || !targetLibraryId) {
    return c.json(v2ErrorBody('schema_mismatch', { field: 'targetLibraryId' }), 422)
  }

  // Size cap BEFORE buffering
  if (fileVal.size > MAX_IMPORT_ZIP_BYTES) {
    return c.json(v2ErrorBody('zip_too_large', { limit: MAX_IMPORT_ZIP_BYTES }), 413)
  }

  const lib = await specReadDao.getLibrary(ctx, targetLibraryId)
  if (!lib) return c.json(v2ErrorBody('not_found'), 404)
  // Visibility is enforced by specReadDao.getLibrary (canSee) above; the write
  // right is enforced downstream by runBatchSave (canDo 'edit', Phase 2a Task 5).

  // Buffer + safe zip read
  const buffer = Buffer.from(await fileVal.arrayBuffer())
  let safeZip
  try {
    safeZip = await readSafeZip(buffer)
  } catch (err) {
    if (err instanceof SafeZipError) {
      const status = safeZipErrorStatus(err)
      return c.json({ code: err.code, ...(err.extra ?? {}) }, status)
    }
    throw err
  }

  // Parse the JSON envelope
  let plan
  try {
    plan = parseWorkflowEnvelope(safeZip.jsonText)
  } catch (err) {
    if (err instanceof EnvelopeParseError) {
      return c.json({ code: err.code, ...(err.extra ?? {}) }, 422)
    }
    throw err
  }

  // Tolerate missing image bytes. Some packages ship without an images/ folder
  // (or with only a subset of the referenced files). Rather than 422 the whole
  // import, drop the imageRefs whose bytes aren't in the ZIP and patch the
  // form-element src to empty so the editor renders the upload placeholder.
  // The runtime sees an empty src and behaves the same way it would if the
  // user never set the image.
  const availableFilenames = new Set<string>(safeZip.images.map((i) => i.filename))
  const missingFilenames = new Set<string>()
  for (const ref of plan.imageRefs) {
    const directHit = availableFilenames.has(ref.filename)
    const specPrefixed = availableFilenames.has(`${ref.specSourceId}-${ref.filename}`)
    let suffixHit = false
    if (!directHit && !specPrefixed) {
      const suffix = `-${ref.filename}`
      for (const fn of availableFilenames) {
        if (fn.endsWith(suffix)) {
          suffixHit = true
          break
        }
      }
    }
    if (!directHit && !specPrefixed && !suffixHit) missingFilenames.add(ref.filename)
  }
  if (missingFilenames.size > 0) {
    plan.imageRefs = plan.imageRefs.filter((r) => !missingFilenames.has(r.filename))
    for (const spec of plan.specs) {
      let parsed: unknown
      try {
        parsed = JSON.parse(spec.dataJson)
      } catch {
        continue
      }
      if (clearMissingImageSrcs(parsed, missingFilenames)) {
        spec.dataJson = JSON.stringify(parsed)
      }
    }
  }

  // Mirror the surviving image bytes into spec.data.images as base64 data URIs.
  // The editor renders images out of that map (the upload-flow source of truth);
  // the legacy image_blob/image tables populated by insertImportImages below are
  // the runtime contract path. Both must be kept in sync on import.
  injectSpecImagesAsDataUris(plan, safeZip.images)

  // Pre-load principal + locked OUTSIDE the transaction.
  // Both use rawQuery which deadlocks inside pglite.transaction(); loading them
  // here lets every read inside the outer TX use the connection-scoped q only.
  const principal = await loadPrincipal(session.userId)
  if (!principal) return c.json(v2ErrorBody('not_found'), 404)
  const locked = await editLockedStates()

  // Single-transaction import: all writes (env/action libraries, workflow
  // specs, image rows) are wrapped in ONE withTransaction so any failure
  // rolls back ALL of them atomically. The old three-transaction design
  // left orphaned libraries and specs on partial failure.
  let importOutcome: {
    newRootId: string | null
    imageInsertCount: number
    specCount: number
    summary: Awaited<ReturnType<typeof importLibrariesFromZip>>
  }

  try {
    importOutcome = await withTransaction(async (q) => {
      // Step 1: Auto-create env + action libraries from the ZIP siblings.
      // Uses the outer q so a downstream failure rolls them back.
      const summary = await importLibrariesFromZip(
        {
          userId: session.userId,
          teamId: lib.teamId,
          envLibraryJsons: safeZip.envLibraries,
          actionLibraryJsons: safeZip.actionLibraries,
        },
        q,
      )

      // Step 2: Remap each workflow's `_pendingEnvironmentSpecs[]` (carried by
      //    the parser) to the freshly-created or pre-existing env spec ids and
      //    write them to `data.environmentSpecIds`. The editor renders attached
      //    env chips out of that field — the library-level
      //    specification_environment row alone is not enough.
      injectWorkflowEnvSpecIds(plan, summary.envSpecIdsByLibraryAndName)

      // Step 3: Resolve v7 pending env-library links by name → id and merge
      //    into plan.specEnvs so buildImportBatch picks them up.
      const resolvedSpecEnvs = [...plan.specEnvs]
      for (const link of plan.pendingEnvLibraryLinks) {
        const libraryId = summary.envLibraryIdsByName.get(link.libraryName)
        if (!libraryId) {
          // No matching JSON in environments/ — the link cannot be resolved. Surfaced
          // as a warning instead of dropping silently (audit item 3).
          summary.warnings.push(
            `Environment link to library "${link.libraryName}" dropped: no matching JSON in the package's environments/ folder`,
          )
          continue
        }
        resolvedSpecEnvs.push({
          specSourceId: link.specSourceId,
          environmentLibraryId: libraryId,
        })
      }
      const resolvedPlan = { ...plan, specEnvs: resolvedSpecEnvs }

      // Step 4: Build the workflow batch. Seed the name deduper with the root
      //    specs already in the target library so a re-import of a workflow
      //    that already exists lands as a renamed copy instead of 409-ing on
      //    specification_root_name_unique.
      //    Uses q (not rawQuery) — rawQuery would deadlock on PGlite inside TX.
      const existingRoots = await q<{ name: string; version: string }>(
        'SELECT name, version FROM "specification" WHERE "libraryId" = $1 AND "parentSpecificationId" IS NULL',
        [targetLibraryId],
      )
      const { batch, idMap, imageInserts } = buildImportBatch(resolvedPlan, targetLibraryId, existingRoots)

      // Re-inject embeddedWorkflowSpecId into each workflowProxy node's data.
      // parseEnvelope strips that field into proxyRefs[] for clean DB
      // serialization; the canvas double-click handler reads
      // node.data.embeddedWorkflowSpecId to navigate into an embedded
      // sub-workflow, so it must be present in the persisted spec data.
      injectEmbeddedWorkflowSpecIds(batch)

      // Step 5: For env links that came from the legacy v3 envelopes, drop ones
      //    whose env library is not visible to the importing user (the same
      //    defensive filter as before). Uses q for the library lookup (same
      //    reasons as above: deadlock + atomicity). canSee uses the pre-loaded
      //    principal which was resolved outside the TX.
      if (plan.specEnvs.length > 0) {
        const visibleEnvIds = new Set<string>()
        // Env libs we just created are visible to this user by definition.
        for (const id of summary.envLibraryIdsByName.values()) visibleEnvIds.add(id)
        for (const e of batch.specEnvs) {
          if (visibleEnvIds.has(e.environmentLibraryId)) continue
          const rows = await q<{ teamId: string | null; entityType: string }>(
            'SELECT "teamId", "entityType" FROM "library" WHERE id = $1',
            [e.environmentLibraryId],
          )
          const envLib = rows[0]
          if (envLib && envLib.entityType === 'environment' && canSee(principal, envLib)) {
            visibleEnvIds.add(e.environmentLibraryId)
          }
        }
        batch.specEnvs = batch.specEnvs.filter((e) => visibleEnvIds.has(e.environmentLibraryId))
      }

      // Step 6: Batch-save workflow specs inside the outer TX.
      // Phase1Error / Phase2Error propagate — runBatchSave does NOT catch them
      // when externalQ is provided, so the TX rolls back on any failure.
      // IMPORTANT: capture the return value. When BatchSaveRequest.safeParse
      // fails (malformed/legacy package with e.g. an out-of-enum state value),
      // runBatchSave RETURNS { status: 422, body } before reaching the externalQ
      // branch — it does NOT throw. Converting to Phase1Error here ensures the TX
      // rolls back and the client gets the honest status, not a false 200.
      const bs = await runBatchSave(batch, ctx, {
        externalQ: q,
        externalPrincipal: principal,
        externalLocked: locked,
      })
      if (bs.status !== 200) throw new Phase1Error(bs.status, bs.body)

      // Step 7: Insert image_blob + image rows inside the outer TX.
      // Any ImportImageMissingError propagates and rolls back everything.
      await insertImportImages(imageInserts, safeZip.images, q)

      const sourceRootId = resolvedPlan.specs.find((s) => s.parentSourceId === null)?.sourceId
      const newRootId = sourceRootId ? (idMap.get(sourceRootId) ?? null) : null

      return {
        newRootId,
        imageInsertCount: imageInserts.length,
        specCount: resolvedPlan.specs.length,
        summary,
      }
    })
  } catch (err) {
    // TX rolled back. Convert known import errors to their HTTP responses.
    if (err instanceof Phase1Error) {
      return c.json(err.body, err.status as 403 | 404 | 409 | 413 | 422 | 500)
    }
    if (err instanceof Phase2Error) {
      return c.json(err.body, err.status as 403 | 404 | 409 | 413 | 422 | 500)
    }
    if (err instanceof ImportImageMissingError) {
      return c.json(
        v2ErrorBody('image_not_found', {
          newSpecId: err.newSpecId,
          filename: err.filename,
        }),
        422,
      )
    }
    throw err
  }

  return c.json(
    {
      rootSpecId: importOutcome.newRootId ?? '',
      specCount: importOutcome.specCount,
      imageCount: importOutcome.imageInsertCount,
      envLibrariesCreated: importOutcome.summary.envLibrariesCreated,
      envLibrariesReused: importOutcome.summary.envLibrariesReused,
      actionLibrariesCreated: importOutcome.summary.actionLibrariesCreated,
      actionLibrariesReused: importOutcome.summary.actionLibrariesReused,
      // Everything the import SKIPPED rather than failed on (audit item 3):
      // unimportable sibling libraries, unresolvable env-library links.
      warnings: importOutcome.summary.warnings,
    },
    200,
  )
})

// Module-level cache; one process holds at most 16 in-flight previews.
const wflibxPreviewCache = new ImportPreviewCache<{
  bundleLibraryName: string
  oidIndex: ParsedBundle['oidIndex']
  warnings: string[]
  parsedJsons: Record<string, unknown>
  imageBytes: Record<string, Uint8Array>
}>({ capacity: 16, ttlMs: 10 * 60 * 1000 })

// Exported for the tests to clear between cases.
export const __wflibxPreviewCacheForTests = wflibxPreviewCache

// The wflibx manifest boundary, zod-parsed ONCE (audit item 3) instead of the
// old blind `as` casts. Matches ParsedBundle['oidIndex'] field for field; extra
// manifest fields (createdAt, files, …) pass through untouched.
const wflibxOidIndexSchema = z.object({
  libraries: z.array(
    z.object({
      oid: z.string(),
      name: z.string(),
      entityType: z.enum(['workflow', 'step', 'environment', 'action']),
      version: z.string(),
    }),
  ),
  specifications: z.array(
    z.object({
      oid: z.string(),
      libraryOid: z.string(),
      name: z.string(),
      version: z.string(),
    }),
  ),
})
const wflibxManifestSchema = z.looseObject({
  packageType: z.string().optional(),
  packageVersion: z.string().optional(),
  libraryName: z.string().optional(),
  oidIndex: wflibxOidIndexSchema.optional(),
})

packagesV2.post('/packages/workflow-library/preview', importUploadLimit, async (c) => {
  const session = c.get('v2Session')
  const principal = await loadPrincipal(session.userId)
  const mayImport =
    !!principal &&
    (principal.isAdministrator ||
      [...principal.rightsByTeam.values()].some((rights) => rights.has('workflow:library.create')))
  if (!principal || !mayImport) return c.json({ code: 'forbidden' }, 403)

  const form = await c.req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return c.json({ code: 'bad_request', message: 'file field required' }, 400)

  // Size cap BEFORE buffering
  if (file.size > MAX_IMPORT_ZIP_BYTES) {
    return c.json(v2ErrorBody('zip_too_large', { limit: MAX_IMPORT_ZIP_BYTES }), 413)
  }

  let zip: JSZip
  try {
    zip = await readSafeLibraryZip(Buffer.from(await file.arrayBuffer()))
  } catch (err) {
    if (err instanceof SafeZipError) {
      if (err.code === 'json_envelope_invalid') return c.json({ code: 'malformed_zip' }, 400)
      return c.json({ code: err.code, ...(err.extra ?? {}) }, safeZipErrorStatus(err))
    }
    throw err
  }
  const manifestEntry = zip.file('manifest.json')
  if (!manifestEntry) return c.json({ code: 'missing_manifest' }, 400)
  let manifestRaw: unknown
  try {
    manifestRaw = JSON.parse(await manifestEntry.async('string'))
  } catch {
    return c.json({ code: 'json_envelope_invalid', reason: 'manifest.json is not valid JSON' }, 400)
  }
  const manifestParsed = wflibxManifestSchema.safeParse(manifestRaw)
  if (!manifestParsed.success) {
    return c.json(
      {
        code: 'json_envelope_invalid',
        reason: 'manifest.json shape invalid',
        issues: manifestParsed.error.issues.slice(0, 5),
      },
      400,
    )
  }
  const manifest = manifestParsed.data
  if (manifest.packageType !== 'workflow-library') return c.json({ code: 'wrong_package_type' }, 400)

  // Build the OID index (1.1 fast-path; 1.0 slow path TBD-next-task).
  let oidIndex: ParsedBundle['oidIndex']
  if (manifest.packageVersion === '1.1' && manifest.oidIndex) {
    oidIndex = manifest.oidIndex
  } else {
    return c.json({ code: 'unsupported_package_version' }, 400)
  }

  // Cache parsed JSONs and image bytes for the commit step.
  const parsedJsons: Record<string, unknown> = {}
  const imageBytes: Record<string, Uint8Array> = {}
  for (const path of Object.keys(zip.files)) {
    if (zip.files[path].dir) continue
    if (path.startsWith('images/')) {
      imageBytes[path] = await zip.files[path].async('uint8array')
    } else if (
      path.endsWith('.WFlib') ||
      path.endsWith('.WFslib') ||
      path.endsWith('.WFenvir') ||
      path.endsWith('.WFaction')
    ) {
      parsedJsons[path] = JSON.parse(await zip.files[path].async('string'))
    }
  }

  // The manifest's index has no state; take each spec's from its JSON so a same-OID spec whose
  // state changed since export is reported, not skipped. Cached below, so the commit sees it too.
  oidIndex = withBundleStates(oidIndex, parsedJsons)

  const existing = await loadExistingDbState(oidIndex)
  const plan = buildImportPlan(
    {
      bundleLibraryName: String(manifest.libraryName ?? ''),
      oidIndex,
      warnings: [],
    },
    existing,
  )
  const warnings = plan.warnings
  // Conflicts whose Replace would touch a locked spec, or that the user may not delete, are
  // shown as refused (spec 2026-10-21 §6). Outside any transaction: both reads use rawQuery/db.
  const rows = await refuseBlockedReplaces(db, plan.rows, existing, principal, await editLockedStates())

  const previewId = wflibxPreviewCache.put({
    bundleLibraryName: String(manifest.libraryName ?? ''),
    oidIndex,
    warnings,
    parsedJsons,
    imageBytes,
  })

  return c.json({
    previewId,
    bundleLibraryName: manifest.libraryName,
    rows,
    warnings,
  })
})

async function loadExistingDbState(oidIndex: ParsedBundle['oidIndex']): Promise<ExistingDbState> {
  const libOids = oidIndex.libraries.map((l) => l.oid)
  const libNameTypes = oidIndex.libraries.map((l) => ({ name: l.name, entityType: l.entityType }))
  const specOids = oidIndex.specifications.map((s) => s.oid)

  const libRows =
    libOids.length === 0 && libNameTypes.length === 0
      ? []
      : await db
          .select()
          .from(libsTable)
          .where(
            or(
              libOids.length > 0 ? inArray(libsTable.id, libOids) : sql`0=1`,
              ...libNameTypes.map((nt) => and(eq(libsTable.name, nt.name), eq(libsTable.entityType, nt.entityType))),
            ),
          )

  const matchedLibIds = libRows.map((l) => l.id)
  const specRows =
    specOids.length === 0 && matchedLibIds.length === 0
      ? []
      : await db
          .select()
          .from(specsTable)
          .where(
            or(
              specOids.length > 0 ? inArray(specsTable.id, specOids) : sql`0=1`,
              matchedLibIds.length > 0 ? inArray(specsTable.libraryId, matchedLibIds) : sql`0=1`,
            ),
          )

  return {
    libraries: libRows.map((l) => ({
      id: l.id,
      name: l.name,
      entityType: l.entityType as WflibxEntityType,
      version: l.version ?? undefined,
      teamId: l.teamId,
    })),
    specifications: specRows.map((s) => ({
      id: s.id,
      libraryId: s.libraryId,
      name: s.name,
      version: s.version ?? undefined,
      state: s.state,
    })),
  }
}

type WflibxCacheEntry = {
  bundleLibraryName: string
  oidIndex: ParsedBundle['oidIndex']
  warnings: string[]
  parsedJsons: Record<string, unknown>
  imageBytes: Record<string, Uint8Array>
}

type WflibxCommitSummary = Omit<PostImportReport, 'danglingReferences' | 'refused'>

interface ParsedLibraryEntry {
  /** The library-level metadata JSON object: { local_id, oid, version, description, ... } */
  library: Record<string, unknown>
  /** Specifications keyed by OID (unique across versions and sibling names) */
  specsByOid: Map<string, Record<string, unknown>>
}

/**
 * Index parsedJsons by oid index, so the commit step can look up the
 * library metadata + specs JSON by bundle library OID without re-walking
 * file paths. Each bundle JSON has shape (per master-workflow-library.json):
 *   { local_id, oid, version, description?, *_specifications: [...] }
 *
 * Back-compat: bundles produced before the schema-compliance fix wrap the
 * library managed-element under a nested `library` field. We accept both
 * shapes here so previously-exported .WFlibX files still import.
 */
function indexParsedJsons(parsedJsons: Record<string, unknown>): Map<string, ParsedLibraryEntry> {
  const byLibOid = new Map<string, ParsedLibraryEntry>()
  for (const path of Object.keys(parsedJsons)) {
    const json = parsedJsons[path] as Record<string, unknown> | undefined
    if (!json || typeof json !== 'object') continue
    // Flat (schema-compliant) shape: oid at top level.
    // Nested (pre-fix) shape: oid under `library`.
    const nestedLib =
      json.library && typeof json.library === 'object' ? (json.library as Record<string, unknown>) : undefined
    const libOid =
      typeof json.oid === 'string' ? json.oid : typeof nestedLib?.oid === 'string' ? (nestedLib.oid as string) : null
    if (!libOid) continue

    const specsByOid = new Map<string, Record<string, unknown>>()
    // Specs live under any of these arrays depending on library type.
    // workflow_specifications covers both workflow libraries and step libraries
    // (exportStepLibrary emits workflow_specifications, not step_specifications).
    const specArrays = [
      json.workflow_specifications,
      json.action_specifications,
      json.environment_specifications,
    ].filter(Array.isArray) as Array<Array<Record<string, unknown>>>

    // Recursively index a spec and any nested children (version-chain entries
    // and inline child workflows live under spec.children per the schema).
    const indexSpec = (spec: Record<string, unknown>) => {
      const oid = typeof spec.oid === 'string' ? spec.oid : null
      if (oid) specsByOid.set(oid, spec)
      const children = spec.children
      if (Array.isArray(children)) {
        for (const child of children) {
          if (child && typeof child === 'object') indexSpec(child as Record<string, unknown>)
        }
      }
    }
    for (const arr of specArrays) {
      for (const spec of arr) indexSpec(spec)
    }
    // The library metadata for the flat shape lives at the top level; for the
    // nested back-compat shape it lives under `library`. Downstream consumers
    // (insertLibraryRow) read fields like description from this object.
    byLibOid.set(libOid, { library: nestedLib ?? json, specsByOid })
  }
  return byLibOid
}

/** The oidIndex with each spec's `state` filled in from its bundle JSON, where the JSON has one. */
function withBundleStates(
  oidIndex: ParsedBundle['oidIndex'],
  parsedJsons: Record<string, unknown>,
): ParsedBundle['oidIndex'] {
  const byLibOid = indexParsedJsons(parsedJsons)
  return {
    ...oidIndex,
    specifications: oidIndex.specifications.map((s) => {
      const state = byLibOid.get(s.libraryOid)?.specsByOid.get(s.oid)?.state
      return typeof state === 'string' ? { ...s, state } : s
    }),
  }
}

/**
 * Find the parsed spec JSON for an import row. The OID-index records the
 * spec's owning bundle library OID; we look up the spec inside that library's
 * index by its bundle OID (unique across version-chain siblings).
 */
function findParsedSpec(
  row: ImportPlanRow,
  oidIndex: ParsedBundle['oidIndex'],
  parsedByLibOid: Map<string, ParsedLibraryEntry>,
): Record<string, unknown> | undefined {
  if (row.kind !== 'specification') return undefined
  const specEntry = oidIndex.specifications.find((s) => s.oid === row.bundleOid)
  if (!specEntry) return undefined
  const libEntry = parsedByLibOid.get(specEntry.libraryOid)
  if (!libEntry) return undefined
  return libEntry.specsByOid.get(row.bundleOid)
}

/**
 * Resolve the bundle library JSON for a library row. The parsedJsons index
 * is keyed by library OID; for library rows the OID is the bundle OID.
 */
function findParsedLibrary(
  row: ImportPlanRow,
  parsedByLibOid: Map<string, ParsedLibraryEntry>,
): Record<string, unknown> | undefined {
  if (row.kind !== 'library') return undefined
  return parsedByLibOid.get(row.bundleOid)?.library
}

/**
 * Apply a single import-plan row inside the transaction. Mirrors the INSERT
 * shapes in src/server/packageFormat/importLibrariesFromZip.ts. The schema
 * (src/server/db/schema.ts) carries:
 *  - library:       id, parentLibraryId, teamId, createdByUserId, name, entityType,
 *                   description, version, createdAt, updatedAt (+ author/changeHistory/...)
 *  - specification: id, libraryId, name, description, version, state, data,
 *                   dataSchemaVersion, history, rootSpecificationId,
 *                   parentSpecificationId, createdAt, updatedAt
 *
 * For roots, `rootSpecificationId = id` (self-reference). Child specs in
 * the bundle are flattened into _pendingChildWorkflows on the parent's data
 * by the existing importer, so we do not re-walk children here.
 */
async function applyRow(
  q: Q,
  row: ImportPlanRow,
  resolutions: Record<string, 'keep' | 'replace'>,
  cached: WflibxCacheEntry,
  parsedByLibOid: Map<string, ParsedLibraryEntry>,
  userId: string,
  teamId: string,
  summary: WflibxCommitSummary,
  locked: Set<string>,
): Promise<void> {
  const now = Date.now()

  if (row.kind === 'library') {
    switch (row.status.tag) {
      case 'no-op':
        summary.noOp.libraries += 1
        return

      case 'create': {
        const libJson = findParsedLibrary(row, parsedByLibOid)
        if (!libJson) {
          // Defensive — the OID was in the index but no JSON found.
          summary.warnings.push(
            `Library "${row.bundleName}" (${row.bundleOid}) skipped: no JSON in the package for its OID`,
          )
          return
        }
        await insertLibraryRow(q, {
          id: row.bundleOid,
          userId,
          teamId,
          name: row.bundleName,
          entityType: row.entityType,
          description: (libJson.description as string | undefined) ?? null,
          version: row.bundleVersion || '1.0.0',
          changeHistory: serializeChangeHistory(libJson),
          now,
        })
        summary.created.libraries += 1
        return
      }

      case 'conflict': {
        const resolution = resolutions[row.bundleOid]
        if (resolution === 'keep') {
          summary.kept.libraries += 1
          return
        }
        // 'replace': delete the existing row (cascades to specs/images per
        // schema.ts FK config), then insert the bundle row using bundleOid.
        // proxy_reference.targetSpecificationId has onDelete:'restrict', so
        // inbound proxy_reference rows for any child spec of this library must
        // be removed before the library (and its cascaded specs) can be deleted.
        // First lock and re-check everything the delete touches (spec 2026-10-21 §6).
        await assertReplaceUnlocked(q, { libraryId: row.status.existingOid }, locked)
        await q(
          `DELETE FROM "proxy_reference"
           WHERE "targetSpecificationId" IN (SELECT id FROM "specification" WHERE "libraryId" = $1)`,
          [row.status.existingOid],
        )
        await q('DELETE FROM "library" WHERE id = $1', [row.status.existingOid])
        const libJson = findParsedLibrary(row, parsedByLibOid)
        if (!libJson) {
          summary.warnings.push(
            `Library "${row.bundleName}" (${row.bundleOid}) replaced-delete ran but re-insert skipped: no JSON in the package for its OID`,
          )
          return
        }
        await insertLibraryRow(q, {
          id: row.bundleOid,
          userId,
          teamId,
          name: row.bundleName,
          entityType: row.entityType,
          description: (libJson.description as string | undefined) ?? null,
          version: row.bundleVersion || '1.0.0',
          changeHistory: serializeChangeHistory(libJson),
          now,
        })
        summary.replaced.libraries += 1
        return
      }

      default:
        return
    }
  }

  // row.kind === 'specification'
  switch (row.status.tag) {
    case 'no-op':
      summary.noOp.specifications += 1
      return

    case 'create': {
      // The parent library was either created in this transaction (above)
      // or pre-existed under the same OID. Either way, the bundle spec's
      // libraryId is its parentLibraryOid.
      if (!row.parentLibraryOid) {
        summary.warnings.push(
          `Specification "${row.bundleName}" (${row.bundleOid}) skipped: no parent library OID in the bundle index`,
        )
        return
      }
      const specJson = findParsedSpec(row, cached.oidIndex, parsedByLibOid)
      if (!specJson) {
        summary.warnings.push(
          `Specification "${row.bundleName}" (${row.bundleOid}) skipped: no JSON in the package for its OID`,
        )
        return
      }
      await insertSpecRow(q, {
        id: row.bundleOid,
        libraryId: row.parentLibraryOid,
        name: row.bundleName,
        description: (specJson.description as string | undefined) ?? null,
        typeName: specTypeName(specJson, row.entityType),
        version: row.bundleVersion || '1.0.0',
        data: buildSpecData(specJson, row.entityType),
        now,
      })
      summary.created.specifications += 1
      return
    }

    case 'add-to-existing': {
      const specJson = findParsedSpec(row, cached.oidIndex, parsedByLibOid)
      if (!specJson) {
        summary.warnings.push(
          `Specification "${row.bundleName}" (${row.bundleOid}) skipped: no JSON in the package for its OID`,
        )
        return
      }
      await insertSpecRow(q, {
        id: row.bundleOid,
        libraryId: row.status.existingLibraryOid,
        name: row.bundleName,
        description: (specJson.description as string | undefined) ?? null,
        typeName: specTypeName(specJson, row.entityType),
        version: row.bundleVersion || '1.0.0',
        data: buildSpecData(specJson, row.entityType),
        now,
      })
      summary.created.specifications += 1
      return
    }

    case 'conflict': {
      const resolution = resolutions[row.bundleOid]
      if (resolution === 'keep') {
        summary.kept.specifications += 1
        return
      }
      // 'replace': delete existing spec by id (cascade clears image/proxy_ref/
      // specification_environment rows per FK config), then insert the bundle
      // spec under the SAME library the existing row belonged to. Looking it
      // up off the existing row keeps the conflict-replace shape semantically
      // close to an in-place update — the library doesn't move.
      //
      // proxy_reference.targetSpecificationId has onDelete:'restrict'. Any
      // other spec that holds a proxy_reference pointing at the existing OID
      // would prevent the DELETE. Those referrers are already captured in
      // danglingReferences and reported to the user. Drop the inbound rows
      // first so the DELETE succeeds inside the transaction.
      // Lock and re-check everything the delete touches (spec 2026-10-21 §6).
      await assertReplaceUnlocked(q, { specIds: [row.status.existingOid] }, locked)
      const [existingLibIdRow] = await q<{ libraryId: string }>(
        'SELECT "libraryId" FROM "specification" WHERE id = $1',
        [row.status.existingOid],
      )
      await q('DELETE FROM "proxy_reference" WHERE "targetSpecificationId" = $1', [row.status.existingOid])
      await q('DELETE FROM "specification" WHERE id = $1', [row.status.existingOid])
      const targetLibId = existingLibIdRow?.libraryId ?? row.parentLibraryOid
      if (!targetLibId) {
        summary.warnings.push(
          `Specification "${row.bundleName}" (${row.bundleOid}) replace skipped: no target library resolvable`,
        )
        return
      }
      const specJson = findParsedSpec(row, cached.oidIndex, parsedByLibOid)
      if (!specJson) {
        summary.warnings.push(
          `Specification "${row.bundleName}" (${row.bundleOid}) replaced-delete ran but re-insert skipped: no JSON in the package for its OID`,
        )
        return
      }
      await insertSpecRow(q, {
        id: row.bundleOid,
        libraryId: targetLibId,
        name: row.bundleName,
        description: (specJson.description as string | undefined) ?? null,
        typeName: specTypeName(specJson, row.entityType),
        version: row.bundleVersion || '1.0.0',
        data: buildSpecData(specJson, row.entityType),
        now,
      })
      summary.replaced.specifications += 1
      return
    }

    default:
      return
  }
}

/**
 * Stable serialization of the bundle library's changeHistory — the bundle
 * JSON ships it as a free string or array depending on producer; we keep
 * the existing string round-trip behavior.
 */
function serializeChangeHistory(libJson: Record<string, unknown>): string | null {
  const ch = libJson.changeHistory ?? libJson.change_history
  if (ch == null) return null
  if (typeof ch === 'string') return ch
  return JSON.stringify(ch)
}

async function insertLibraryRow(
  q: Q,
  row: {
    id: string
    userId: string
    teamId: string
    name: string
    entityType: WflibxEntityType
    description: string | null
    version: string
    changeHistory: string | null
    now: number
  },
): Promise<void> {
  // Phase 5d slice 5: created libraries land in the user-chosen target team.
  // Phase 5d slice 6a: library.userId is dropped; attribution lives in
  // createdByUserId (the only column that still records the creating user).
  await q(
    `INSERT INTO "library"
       (id, "parentLibraryId", "teamId", "createdByUserId", name, "entityType", description, version, "changeHistory",
        "createdAt", "updatedAt")
     VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      row.id,
      row.teamId,
      row.userId,
      row.name,
      row.entityType,
      row.description,
      row.version,
      row.changeHistory,
      row.now,
      row.now,
    ],
  )
}

async function insertSpecRow(
  q: Q,
  row: {
    id: string
    libraryId: string
    name: string
    description: string | null
    typeName: string | null
    version: string
    data: Record<string, unknown>
    now: number
  },
): Promise<void> {
  // rootSpecificationId is self-referential for a root spec (the bundle
  // flattens nested workflows into _pendingChildWorkflows on the parent's
  // data, so every inserted row here is a root).
  await q(
    `INSERT INTO "specification"
       (id, "libraryId", name, description, "typeName", version, state, data, "dataSchemaVersion",
        "parentSpecificationId", "rootSpecificationId", history, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $10, $5, 'Draft', $6, $9, NULL, $1, '[]', $7, $8)`,
    [
      row.id,
      row.libraryId,
      row.name,
      row.description,
      row.version,
      JSON.stringify(row.data),
      row.now,
      row.now,
      CURRENT_DATA_SCHEMA_VERSION,
      row.typeName,
    ],
  )
}

/**
 * For one inserted workflow/step spec row, resolve any
 * `_pendingEnvironmentSpecs[]` entries to env spec OIDs via the lookup map
 * and write them back as `environmentSpecIds`. Strips the sidecar field
 * either way so post-resolve spec data is the clean editor shape. Updates
 * the row in place via an UPDATE. Mirrors the resolution logic in
 * src/server/packageFormat/injectWorkflowEnvSpecIds.ts.
 */
async function resolvePendingEnvSpecsForRow(
  q: Q,
  specId: string,
  envSpecMap: Map<string, Map<string, string>>,
): Promise<void> {
  const [row] = await q<{ data: string }>('SELECT data FROM "specification" WHERE id = $1', [specId])
  if (!row) return
  let parsed: Record<string, unknown>
  try {
    const candidate = JSON.parse(row.data)
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return
    parsed = candidate as Record<string, unknown>
  } catch {
    return
  }
  const pending = parsed._pendingEnvironmentSpecs
  if (!Array.isArray(pending)) return

  const resolved: string[] = []
  for (const entry of pending as Array<{ name?: unknown; libraryName?: unknown; data?: { _libraryName?: unknown } }>) {
    if (!entry || typeof entry !== 'object') continue
    const libraryName =
      (typeof entry.data === 'object' &&
      entry.data &&
      typeof (entry.data as { _libraryName?: unknown })._libraryName === 'string'
        ? (entry.data as { _libraryName: string })._libraryName
        : null) ?? (typeof entry.libraryName === 'string' ? entry.libraryName : null)
    if (!libraryName) continue
    const specName = entry.name
    if (typeof specName !== 'string' || !specName) continue
    const id = envSpecMap.get(libraryName)?.get(specName)
    if (id) resolved.push(id)
  }
  delete parsed._pendingEnvironmentSpecs

  if (resolved.length > 0) {
    const existing = Array.isArray(parsed.environmentSpecIds)
      ? (parsed.environmentSpecIds.filter((x) => typeof x === 'string') as string[])
      : []
    const merged: string[] = []
    const seen = new Set<string>()
    for (const id of [...existing, ...resolved]) {
      if (seen.has(id)) continue
      seen.add(id)
      merged.push(id)
    }
    parsed.environmentSpecIds = merged
  }

  await q('UPDATE "specification" SET data = $1, "updatedAt" = $2 WHERE id = $3', [
    JSON.stringify(parsed),
    Date.now(),
    specId,
  ])
}

/**
 * Walk a newly-inserted spec's data and write image_blob + image rows for
 * every image filename referenced by a form-layout element. Mirrors
 * src/server/packageFormat/insertImportImages.ts:1-78 but reads bytes from
 * the cached preview map rather than a SafeZipImage[] array.
 */
async function insertWflibxImagesForSpec(
  q: Q,
  specId: string,
  specData: Record<string, unknown>,
  imageBytes: Record<string, Uint8Array>,
  warnings: string[],
): Promise<void> {
  const filenamesNeeded = new Set<string>()

  const collectFromLayouts = (layouts: unknown) => {
    if (!layouts) return
    if (Array.isArray(layouts)) {
      for (const layout of layouts) {
        const elements = (layout as { elements?: unknown }).elements
        if (!Array.isArray(elements)) continue
        for (const el of elements) {
          if (!el || typeof el !== 'object') continue
          const e = el as Record<string, unknown>
          if (e.type !== 'image') continue
          const filename = (typeof e.src === 'string' && e.src) || (typeof e.image === 'string' && e.image)
          if (
            typeof filename === 'string' &&
            filename.length > 0 &&
            !filename.startsWith('data:') &&
            !/^https?:/.test(filename)
          )
            filenamesNeeded.add(filename.replace(/^[A-Z0-9]+-/, ''))
        }
      }
    } else if (typeof layouts === 'object') {
      for (const layout of Object.values(layouts as Record<string, unknown>)) {
        const elements = (layout as { elements?: unknown }).elements
        if (!Array.isArray(elements)) continue
        for (const el of elements) {
          if (!el || typeof el !== 'object') continue
          const e = el as Record<string, unknown>
          if (e.type !== 'image') continue
          if (typeof e.src !== 'string' || !e.src) continue
          if (e.src.startsWith('data:') || /^https?:/.test(e.src)) continue
          filenamesNeeded.add(e.src.replace(/^[A-Z0-9]+-/, ''))
        }
      }
    }
  }

  // v2 formDocument shape: node.data.formDocument.sections[].rows[].blocks[].
  const collectFromDocument = (docUnknown: unknown) => {
    const doc = docUnknown as
      | { sections?: Array<{ rows?: Array<{ blocks?: Array<Record<string, unknown>> }> }> }
      | undefined
    if (!doc?.sections) return
    for (const section of doc.sections) {
      for (const row of section.rows ?? []) {
        for (const block of row.blocks ?? []) {
          if (block.type !== 'image') continue
          const src = block.src
          if (typeof src !== 'string' || !src || src === 'No image selected') continue
          if (src.startsWith('data:') || /^https?:/.test(src)) continue
          filenamesNeeded.add(src.replace(/^[A-Z0-9]+-/, ''))
        }
      }
    }
  }

  const nodes = (specData.nodes as Array<Record<string, unknown>> | undefined) ?? []
  for (const node of nodes) {
    const innerData = node.data as Record<string, unknown> | undefined
    collectFromLayouts(innerData?.formLayouts)
    collectFromLayouts(node.formLayouts)
    collectFromDocument(innerData?.formDocument)
  }

  if (filenamesNeeded.size === 0) return

  // Build a filename → bytes/mime map. Keys in cached.imageBytes are zip
  // paths like `images/<filename>` or `images/<oid>-<filename>`.
  const byBareFilename = new Map<string, { bytes: Uint8Array; key: string }>()
  const allEntries: Array<{ bytes: Uint8Array; key: string; filename: string }> = []
  for (const [path, bytes] of Object.entries(imageBytes)) {
    if (!path.startsWith('images/')) continue
    const filename = path.substring('images/'.length)
    allEntries.push({ bytes, key: path, filename })
    if (!byBareFilename.has(filename)) byBareFilename.set(filename, { bytes, key: path })
  }

  const now = Date.now()
  for (const wantFilename of filenamesNeeded) {
    let match = byBareFilename.get(wantFilename)
    if (!match) {
      // Suffix match for `<oid>-<filename>` form-element images.
      const suffix = `-${wantFilename}`
      for (const entry of allEntries) {
        if (entry.filename.endsWith(suffix)) {
          match = { bytes: entry.bytes, key: entry.key }
          break
        }
      }
    }
    if (!match) continue // Bytes not in the bundle — drop silently.

    // M1: pass Buffer to ensure bytea is written correctly under PGlite/Postgres.
    const buf = Buffer.from(match.bytes)
    // The file's own bytes decide its type; its name and extension are not trusted.
    const mimeType = sniffMime(buf)
    if (!mimeType || !ALLOWED_IMAGE_MIMES.has(mimeType)) {
      warnings.push(`Skipped image "${wantFilename}": not a PNG, JPEG, WebP or GIF image.`)
      continue
    }
    const contentHash = createHash('sha256').update(buf).digest('hex')
    const imageId = randomUUID()

    await q(
      `INSERT INTO "image_blob" ("contentHash", data, "mimeType", "byteSize", "createdAt", "refCount")
       VALUES ($1, $2, $3, $4, $5, 0)
       ON CONFLICT("contentHash") DO NOTHING`,
      [contentHash, buf, mimeType, buf.length, now],
    )
    await q(
      `INSERT INTO "image" (id, "specificationId", filename, "mimeType", "contentHash", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [imageId, specId, wantFilename, mimeType, contentHash, now],
    )
  }
}

packagesV2.post('/packages/workflow-library/commit', async (c) => {
  const session = c.get('v2Session')
  const principal = await loadPrincipal(session.userId)
  if (!principal) return c.json({ code: 'forbidden' }, 403)

  let body: { previewId: string; resolutions: Record<string, 'keep' | 'replace'>; teamId: string }
  try {
    body = (await c.req.json()) as {
      previewId: string
      resolutions: Record<string, 'keep' | 'replace'>
      teamId: string
    }
  } catch {
    return c.json({ code: 'bad_request', message: 'invalid JSON body' }, 400)
  }
  if (!body?.previewId || typeof body.previewId !== 'string') {
    return c.json({ code: 'bad_request', message: 'previewId required' }, 400)
  }
  if (!body?.teamId || typeof body.teamId !== 'string') {
    return c.json({ code: 'bad_request', message: 'teamId required' }, 400)
  }
  const cached = wflibxPreviewCache.get(body.previewId)
  if (!cached) return c.json({ code: 'preview_expired' }, 410)

  // Rebuild the plan against the *current* DB state. We never trust a
  // client-supplied plan; we recompute and apply user resolutions.
  const existing = await loadExistingDbState(cached.oidIndex)
  const plan = buildImportPlan(
    {
      bundleLibraryName: cached.bundleLibraryName,
      oidIndex: cached.oidIndex,
      warnings: cached.warnings,
    },
    existing,
  )

  // Never replace a released spec (spec 2026-10-21 §6): re-check on the current DB state, first
  // and before any rights check. Refused rows need no resolution and are kept as they are; a
  // 'replace' sent for one anyway is refused outright. Outside withTransaction (rawQuery).
  const locked = await editLockedStates()
  const rows = await refuseBlockedReplaces(db, plan.rows, existing, principal, locked)
  const lockedReplace = rows.find(
    (r) => r.status.tag === 'refused' && (body.resolutions ?? {})[r.bundleOid] === 'replace',
  )
  if (lockedReplace) {
    return c.json({ error: 'locked_replace', code: 'locked_replace', bundleOid: lockedReplace.bundleOid }, 422)
  }

  // Per-entity-type authorization (spec §3.2 step 3), migrated from legacy user
  // flags to team rights: the user must hold `<category>:library.create` in the
  // chosen target team for every category this import will write.
  const willWrite = new Set<WflibxEntityType>()
  for (const r of rows) {
    if (r.status.tag === 'no-op' || r.status.tag === 'refused') continue
    if (r.status.tag === 'conflict' && (body.resolutions ?? {})[r.bundleOid] === 'keep') continue
    willWrite.add(r.entityType)
  }
  // GLOBAL never holds workflow libraries (spec 2026-10-12 U2) — refuse before writing anything.
  const notInGlobal = globalForbiddenEntityTypes(body.teamId, willWrite)
  if (notInGlobal.length > 0) {
    return c.json({ code: 'forbidden_entity_types', disallowedEntityTypes: notInGlobal }, 403)
  }
  const disallowed: WflibxEntityType[] = []
  for (const et of willWrite) {
    if (!canDo(principal, 'library.create', { teamId: body.teamId, entityType: et })) disallowed.push(et)
  }
  if (disallowed.length > 0) {
    return c.json({ code: 'forbidden_entity_types', disallowedEntityTypes: disallowed }, 403)
  }

  // Rows match existing libraries in ANY team; writing into one needs the right in that library's
  // own team — GLOBAL, another team, or the import's target team alike (spec 2026-10-12 U3,
  // spec 2026-10-21 §6).
  const otherWrites = existingLibraryWrites(rows, body.resolutions ?? {}, existing)
  if (otherWrites.length > 0) {
    const touched = await db
      .select({ id: libsTable.id, teamId: libsTable.teamId, name: libsTable.name })
      .from(libsTable)
      .where(inArray(libsTable.id, [...new Set(otherWrites.map((w) => w.libraryId))]))
    const refused = new Set<string>()
    for (const w of otherWrites) {
      const lib = touched.find((l) => l.id === w.libraryId)
      if (!lib) continue
      if (!canDo(principal, w.verb, { teamId: lib.teamId, entityType: w.entityType })) refused.add(lib.name)
    }
    if (refused.size > 0) {
      return c.json(v2ErrorBody('forbidden', { reason: 'other_team_library', libraries: [...refused] }), 403)
    }
  }

  // Validate every conflict row has a valid resolution ('keep' or 'replace').
  for (const row of rows) {
    if (row.status.tag !== 'conflict') continue
    const r = body.resolutions?.[row.bundleOid]
    if (r !== 'keep' && r !== 'replace') {
      return c.json({ code: 'missing_resolution', bundleOid: row.bundleOid }, 422)
    }
  }

  // Compute pre-replace dangling references. Done *before* the apply step
  // so the report describes the pre-image of the database the user is
  // committing to replace.
  const resolutions = body.resolutions ?? {}
  const replacedSpecOids = new Set<string>()
  const replacedActionLibNames = new Set<string>()
  for (const row of rows) {
    if (row.status.tag !== 'conflict') continue
    if (resolutions[row.bundleOid] !== 'replace') continue
    if (row.kind === 'specification') replacedSpecOids.add(row.status.existingOid)
    if (row.kind === 'library') {
      if (row.entityType === 'action') replacedActionLibNames.add(row.bundleName)
    }
  }
  const allLocalSpecs = await db.select().from(specsTable)
  // Fetch entity types for all local libraries (not just the ones in the
  // bundle's oidIndex) so the dangling-ref report carries the right
  // referrerEntityType for any spec, including ones whose library is not
  // part of this import.
  const allLocalLibs = await db.select({ id: libsTable.id, entityType: libsTable.entityType }).from(libsTable)
  const libEntityTypeById = new Map<string, WflibxEntityType>(
    allLocalLibs.map((l) => [l.id, l.entityType as WflibxEntityType]),
  )
  const excludedReferrerOids = new Set(
    rows
      .filter((r) => r.kind === 'specification')
      .flatMap((r) => {
        // Specs being replaced: their existing OID leaves the DB, so they
        // cannot be a live referrer after the commit.
        if (r.status.tag === 'conflict' && resolutions[r.bundleOid] === 'replace') return [r.status.existingOid]
        // No-op specs: their OID is already in the DB and remains unchanged,
        // so they are definitely not dangling referrers.
        if (r.status.tag === 'no-op') return [r.status.existingOid]
        return []
      })
      .filter(Boolean),
  )
  const danglingReferences = findDanglingReferences({
    replacedSpecOids,
    replacedActionLibNames,
    excludedReferrerOids,
    specifications: allLocalSpecs.map((s) => ({
      id: s.id,
      libraryId: s.libraryId,
      name: s.name,
      entityType: libEntityTypeById.get(s.libraryId) ?? ('workflow' as WflibxEntityType),
      data: JSON.parse(s.data) as Record<string, unknown>,
    })),
  })

  const summary: WflibxCommitSummary = {
    created: { libraries: 0, specifications: 0 },
    replaced: { libraries: 0, specifications: 0 },
    kept: { libraries: 0, specifications: 0 },
    noOp: { libraries: 0, specifications: 0 },
    warnings: [],
  }

  const parsedByLibOid = indexParsedJsons(cached.parsedJsons)

  try {
    await withTransaction(async (q) => {
      // Topological order: action → environment → step → workflow.
      // Same-type rows: libraries before specifications (FK dependency).
      // Refused rows write nothing; they are listed in report.refused instead.
      const writable = rows.filter((r) => r.status.tag !== 'refused')
      const order: WflibxEntityType[] = ['action', 'environment', 'step', 'workflow']
      for (const et of order) {
        for (const row of writable) {
          if (row.entityType !== et) continue
          if (row.kind !== 'library') continue
          await applyRow(q, row, resolutions, cached, parsedByLibOid, session.userId, body.teamId, summary, locked)
        }
        for (const row of writable) {
          if (row.entityType !== et) continue
          if (row.kind !== 'specification') continue
          await applyRow(q, row, resolutions, cached, parsedByLibOid, session.userId, body.teamId, summary, locked)
        }
      }

      // Resolve `_pendingEnvironmentSpecs[]` on every workflow/step spec we
      // just inserted. importWorkflowSpecToInternal extracts the inlined
      // `environment_specifications` array (carried by the bundle's workflow
      // JSON) into this sidecar field; the editor's SpecificationHeader
      // renders attached-environment chips out of `data.environmentSpecIds`,
      // so without this remap the imported workflow looks unattached and
      // exported runtime packages drop the env references entirely.
      //
      // Mirrors injectWorkflowEnvSpecIds in the runtime-package import path
      // (src/server/packageFormat/injectWorkflowEnvSpecIds.ts) but operates
      // on already-persisted rows because applyRow inserts each spec
      // immediately. Build the (envLibName, envSpecName) → envSpecId map
      // from the post-apply DB state so it reflects whichever OIDs are
      // actually in the database (newly created, kept, or replaced).
      const envSpecMap = await buildEnvSpecLookup(q, body.teamId)
      for (const row of rows) {
        if (row.kind !== 'specification') continue
        if (row.entityType !== 'workflow' && row.entityType !== 'step') continue
        const tag = row.status.tag
        if (tag === 'no-op' || tag === 'refused') continue
        if (tag === 'conflict' && resolutions[row.bundleOid] === 'keep') continue
        // Resolve against the actually-inserted spec row; for conflict+replace
        // the existing-OID row is gone and the bundleOid row is in place.
        const insertedId =
          tag === 'conflict' && resolutions[row.bundleOid] === 'replace' ? row.bundleOid : row.bundleOid
        await resolvePendingEnvSpecsForRow(q, insertedId, envSpecMap)
      }

      // Image writes: walk every spec row we just inserted (kind=spec with a
      // resolution that ended in a write — created/add-to-existing/replace).
      for (const row of rows) {
        if (row.kind !== 'specification') continue
        const tag = row.status.tag
        if (tag === 'no-op' || tag === 'refused') continue
        if (tag === 'conflict' && resolutions[row.bundleOid] === 'keep') continue
        const specJson = findParsedSpec(row, cached.oidIndex, parsedByLibOid)
        if (!specJson) continue
        const data = buildSpecData(specJson, row.entityType)
        await insertWflibxImagesForSpec(q, row.bundleOid, data, cached.imageBytes, summary.warnings)
      }
    })
  } catch (err) {
    // A spec was released after the pre-check; the in-transaction re-check rolled everything back.
    if (err instanceof LockedReplaceError) {
      return c.json({ error: 'locked_replace', code: 'locked_replace', blockers: err.blockers }, 422)
    }
    // Scrub before returning: a raw driver/trigger message here would leak
    // SQLite internals to the client (audit item 3). Details go to the log.
    console.error('[wflibx commit] transaction failed:', err)
    const raw = err instanceof Error ? err.message : String(err)
    const msg = scrubSqliteText(raw) || 'import failed and was rolled back'
    return c.json({ code: 'commit_failed', message: msg }, 500)
  }

  wflibxPreviewCache.evict(body.previewId)

  const report: PostImportReport = { ...summary, danglingReferences, refused: refusedReport(rows) }
  return c.json(report)
})

/**
 * Walk a parsed spec data blob and clear `src` (v7 internal shape) /
 * `image` (v3 inline shape) on any image element whose filename is in
 * `missing`, plus the v2 formDocument shape (see below). Returns true when
 * at least one element was cleared so the caller can re-stringify only when
 * needed. Operates in place on the parsed object.
 */
function clearMissingImageSrcs(parsed: unknown, missing: Set<string>): boolean {
  if (!parsed || typeof parsed !== 'object') return false
  const nodes = (parsed as { nodes?: unknown }).nodes
  if (!Array.isArray(nodes)) return false
  let changed = false

  for (const rawNode of nodes) {
    if (!rawNode || typeof rawNode !== 'object') continue
    const node = rawNode as Record<string, unknown>

    // v7 internal shape: node.data.formLayouts.{phone|tablet|desktop}.elements[].src
    const innerData = node.data as Record<string, unknown> | undefined
    const v7Layouts = innerData?.formLayouts as Record<string, unknown> | undefined
    if (v7Layouts && typeof v7Layouts === 'object') {
      for (const layout of Object.values(v7Layouts)) {
        const elements = (layout as { elements?: unknown }).elements
        if (!Array.isArray(elements)) continue
        for (const el of elements) {
          if (!el || typeof el !== 'object') continue
          const elObj = el as Record<string, unknown>
          if (elObj.type !== 'image') continue
          if (typeof elObj.src !== 'string') continue
          if (!missing.has(elObj.src)) continue
          elObj.src = ''
          changed = true
        }
      }
    }

    // v2 formDocument shape: node.data.formDocument.sections[].rows[].blocks[]
    const v2Doc = innerData?.formDocument as
      | { sections?: Array<{ rows?: Array<{ blocks?: Array<Record<string, unknown>> }> }> }
      | undefined
    if (v2Doc?.sections) {
      for (const section of v2Doc.sections) {
        for (const row of section.rows ?? []) {
          for (const block of row.blocks ?? []) {
            if (block.type !== 'image') continue
            if (typeof block.src !== 'string') continue
            if (!missing.has(block.src)) continue
            // v2 src has minLength:1 — '' would invalidate the document. Use the palette
            // placeholder and drop the dangling imageOid (spec §5).
            block.src = 'No image selected'
            delete block.imageOid
            changed = true
          }
        }
      }
    }

    // v3 inline shape: node.formLayouts[].elements[].image (with stepOid prefix)
    const v3Layouts = node.formLayouts
    if (Array.isArray(v3Layouts)) {
      for (const layout of v3Layouts) {
        const elements = (layout as { elements?: unknown }).elements
        if (!Array.isArray(elements)) continue
        for (const el of elements) {
          if (!el || typeof el !== 'object') continue
          const elObj = el as Record<string, unknown>
          if (elObj.type !== 'image') continue
          if (typeof elObj.image !== 'string') continue
          const stripped = elObj.image.replace(/^[A-Z0-9]+-/, '')
          if (!missing.has(stripped)) continue
          elObj.image = ''
          changed = true
        }
      }
    }
  }
  return changed
}

/**
 * The ISA 88 `type_name` of a bundled spec. Only workflow/step specs carry one;
 * action and environment specs always import with no type.
 */
function specTypeName(specJson: Record<string, unknown>, entityType: WflibxEntityType): string | null {
  return entityType === 'workflow' || entityType === 'step' ? readTypeName(specJson.type_name) : null
}

/**
 * Build the `specification.data` JSON for a row, using the in-codebase
 * importers (so all the transforms — form-layout hydration, pending env
 * specs extraction, parameter remapping — run consistently). The data
 * shape varies by entityType: action specs carry inputs/outputs/values,
 * env specs carry included_actions/values/resources, workflow & step specs
 * carry nodes/edges + workflow-level fields.
 */
function buildSpecData(specJson: Record<string, unknown>, entityType: WflibxEntityType): Record<string, unknown> {
  switch (entityType) {
    case 'action':
      return wrapAndImport('action_specifications', specJson)
    case 'environment':
      return wrapAndImport('environment_specifications', specJson)
    case 'workflow':
    case 'step':
      return importWorkflowSpecToInternal(specJson as never, Date.now()).data
  }
}

/**
 * Wrap a single action or environment spec in a minimal library envelope
 * so the library-level validator + importer accepts it, then pull out the
 * single resulting data blob.
 */
function wrapAndImport(
  wrapKey: 'action_specifications' | 'environment_specifications',
  spec: Record<string, unknown>,
): Record<string, unknown> {
  const envelope = {
    local_id: 'tmp',
    version: '1.0.0',
    [wrapKey]: [spec],
  }
  const importer = wrapKey === 'action_specifications' ? importActionLibrary : importEnvironmentLibrary
  const result = importer(envelope)
  if ('error' in result || !result.specifications[0]) {
    // Fall back to whatever data field the bundle carried — better than
    // silently dropping the spec. Only fires on malformed exports.
    return (spec.data as Record<string, unknown> | undefined) ?? {}
  }
  return result.specifications[0].data
}
