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

// Phase 2 of the v7.0 envelope migration — env / action library auto-create
// during workflow package import.
//
// The v7.0 ZIP layout includes sibling JSONs:
//   environments/{LibName}.WFenvir   — full environment library
//   actions/{LibName}.WFaction       — full action library
//
// On import we reconstruct any missing libraries in the importing user's
// account so the workflow's `specification_environment` rows can link to a
// real library id. Without this step (the pre-Phase-2 behavior), env links
// were silently dropped — the data-loss bug from the 2026-04-15 backlog.
//
// Conflict policy (initial implementation): match by (teamId, name,
// entityType). If the target team already owns a library with that name,
// reuse it as-is; otherwise reuse GLOBAL's as-is (never written to); new
// libraries are created only on a miss in both (spec 2026-10-12 §4.6).
// Merge / rename UX is a future improvement; the runtime contract is satisfied
// either way because env libs are referenced by name throughout the workflow.

import { randomUUID } from 'node:crypto'
import { importEnvironmentLibrary, importActionLibrary } from '@/lib/import/library-importers'
import { CURRENT_DATA_SCHEMA_VERSION } from '@/lib/data-schema-version'
import type { SafeZipSiblingJson } from './safeZipReader'
import { GLOBAL_TEAM_ID } from '@/lib/global-team'

/** Connection-scoped rawQuery function threaded from the caller's withTransaction. */
type Q = <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R[]>

export interface ImportedLibraryMaps {
  /** Env library name → id (existing or freshly created) for the importing user. */
  envLibraryIdsByName: Map<string, string>
  /** Action library name → id (existing or freshly created) for the importing user. */
  actionLibraryIdsByName: Map<string, string>
  /**
   * envLibraryName → (envSpecName → envSpecId). Lets the workflow-side import
   * remap each `_pendingEnvironmentSpecs[]` entry (which carries `name` +
   * `libraryName`) to the freshly-created or pre-existing env spec id, so the
   * imported workflow's `data.environmentSpecIds` actually points at real
   * specs in the importing user's account.
   */
  envSpecIdsByLibraryAndName: Map<string, Map<string, string>>
  /** How many env libraries were created vs. reused. */
  envLibrariesCreated: number
  envLibrariesReused: number
  /** How many action libraries were created vs. reused. */
  actionLibrariesCreated: number
  actionLibrariesReused: number
  /**
   * Human-readable notes for every sibling JSON that was SKIPPED instead of
   * imported (malformed JSON, failed importer validation). Before audit item 3
   * these were silent `continue`s — a package could lose whole libraries with
   * no trace anywhere.
   */
  warnings: string[]
}

interface SpecRow {
  id: string
}

// NOTE: The library UNIQUE constraint is per-(teamId, name, entityType,
// parentLibraryId). This lookup is a SELECT only and is unaffected by that
// constraint. Re-imports reuse the env/action library of the *target team*;
// failing that, GLOBAL's (spec 2026-10-12 §4.6 — the team library wins).
async function lookupLibrary(
  q: Q,
  teamId: string | null,
  name: string,
  entityType: 'environment' | 'action',
): Promise<{ id: string; isGlobal: boolean } | null> {
  const rows = await q<{ id: string; teamId: string }>(
    `SELECT id, "teamId" FROM library
      WHERE ("teamId" IS NOT DISTINCT FROM $1 OR "teamId" = $4) AND name = $2 AND "entityType" = $3
        AND "parentLibraryId" IS NULL
      ORDER BY ("teamId" IS NOT DISTINCT FROM $1) DESC
      LIMIT 1`,
    [teamId, name, entityType, GLOBAL_TEAM_ID],
  )
  const row = rows[0]
  return row ? { id: row.id, isGlobal: row.teamId === GLOBAL_TEAM_ID && teamId !== GLOBAL_TEAM_ID } : null
}

async function insertLibrary(
  q: Q,
  args: {
    userId: string
    teamId: string | null
    createdByUserId: string
    name: string
    entityType: 'environment' | 'action'
    description: string | null
    version: string
  },
): Promise<string> {
  const id = randomUUID()
  const now = Date.now()
  await q(
    `INSERT INTO library (id, "parentLibraryId", "teamId", "createdByUserId", name, "entityType", description, version, "createdAt", "updatedAt")
     VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, args.teamId, args.createdByUserId, args.name, args.entityType, args.description, args.version, now, now],
  )
  return id
}

async function lookupSpecId(q: Q, libraryId: string, name: string): Promise<string | null> {
  const rows = await q<SpecRow>(`SELECT id FROM specification WHERE "libraryId" = $1 AND name = $2 LIMIT 1`, [
    libraryId,
    name,
  ])
  return rows[0]?.id ?? null
}

/**
 * Read every spec id in a library keyed by name. Used to populate the
 * envSpec lookup map on the "reuse" branch where the existing library's
 * specs are kept as-is. Returns an empty Map for an unknown library.
 */
async function listSpecIdsByName(q: Q, libraryId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const rows = await q<{ id: string; name: string }>(`SELECT id, name FROM specification WHERE "libraryId" = $1`, [
    libraryId,
  ])
  for (const row of rows) {
    if (!out.has(row.name)) out.set(row.name, row.id)
  }
  return out
}

async function insertSpec(
  q: Q,
  args: { libraryId: string; name: string; description: string | null; data: unknown },
): Promise<string> {
  const id = randomUUID()
  const now = Date.now()
  await q(
    `INSERT INTO specification
       (id, "libraryId", name, description, version, state, data, "dataSchemaVersion",
        "parentSpecificationId", "rootSpecificationId", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, '1.0.0', 'Draft', $5, $8, NULL, $1, $6, $7)`,
    [id, args.libraryId, args.name, args.description, JSON.stringify(args.data), now, now, CURRENT_DATA_SCHEMA_VERSION],
  )
  return id
}

/**
 * Auto-create environment + action libraries from the ZIP siblings, returning
 * name → id maps suitable for downstream link resolution.
 *
 * Idempotent on (teamId, name, entityType) within the target team: a re-import
 * of the same package returns the same library ids and inserts no duplicates.
 *
 * Must be called with the `q` from the same outer withTransaction as the
 * workflow batchSave so a downstream failure rolls back the auto-created
 * libraries too. Do NOT call rawQuery directly inside this function — the
 * Pool would use a different connection and break atomicity.
 */
export async function importLibrariesFromZip(
  args: {
    userId: string
    teamId: string | null
    envLibraryJsons: SafeZipSiblingJson[]
    actionLibraryJsons: SafeZipSiblingJson[]
  },
  q: Q,
): Promise<ImportedLibraryMaps> {
  const envLibraryIdsByName = new Map<string, string>()
  const actionLibraryIdsByName = new Map<string, string>()
  const envSpecIdsByLibraryAndName = new Map<string, Map<string, string>>()
  const warnings: string[] = []
  let envLibrariesCreated = 0
  let envLibrariesReused = 0
  let actionLibrariesCreated = 0
  let actionLibrariesReused = 0

  // Action libraries first — they have no cross-references in v7 ZIPs and env
  // libraries reference action libs by name, so creating them up front keeps
  // the dependency graph trivial.
  for (const lib of args.actionLibraryJsons) {
    const existing = await lookupLibrary(q, args.teamId, lib.name, 'action')
    if (existing) {
      actionLibraryIdsByName.set(lib.name, existing.id)
      actionLibrariesReused += 1
      if (existing.isGlobal) warnings.push(`Action library "${lib.name}" linked to the GLOBAL library`)
      continue
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(lib.jsonText)
    } catch {
      // Malformed sibling JSON — skip rather than fail the whole import, but say so.
      warnings.push(`Action library "${lib.name}" skipped: sibling JSON is not valid JSON`)
      continue
    }
    const result = importActionLibrary(parsed)
    if ('error' in result) {
      warnings.push(`Action library "${lib.name}" skipped: ${result.error}`)
      continue
    }

    const newLibId = await insertLibrary(q, {
      userId: args.userId,
      teamId: args.teamId,
      createdByUserId: args.userId,
      name: result.library.name,
      entityType: 'action',
      description: result.library.description ?? null,
      version: result.library.version ?? '1.0.0',
    })
    actionLibraryIdsByName.set(lib.name, newLibId)
    actionLibrariesCreated += 1

    for (const spec of result.specifications) {
      await insertSpec(q, {
        libraryId: newLibId,
        name: spec.name,
        description: spec.description ?? null,
        data: spec.data,
      })
    }
  }

  for (const lib of args.envLibraryJsons) {
    const existing = await lookupLibrary(q, args.teamId, lib.name, 'environment')
    if (existing) {
      envLibraryIdsByName.set(lib.name, existing.id)
      envSpecIdsByLibraryAndName.set(lib.name, await listSpecIdsByName(q, existing.id))
      envLibrariesReused += 1
      if (existing.isGlobal) warnings.push(`Environment library "${lib.name}" linked to the GLOBAL library`)
      continue
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(lib.jsonText)
    } catch {
      warnings.push(`Environment library "${lib.name}" skipped: sibling JSON is not valid JSON`)
      continue
    }
    const result = importEnvironmentLibrary(parsed)
    if ('error' in result) {
      warnings.push(`Environment library "${lib.name}" skipped: ${result.error}`)
      continue
    }

    const newLibId = await insertLibrary(q, {
      userId: args.userId,
      teamId: args.teamId,
      createdByUserId: args.userId,
      name: result.library.name,
      entityType: 'environment',
      description: result.library.description ?? null,
      version: result.library.version ?? '1.0.0',
    })
    envLibraryIdsByName.set(lib.name, newLibId)
    envLibrariesCreated += 1

    const specIdsByName = new Map<string, string>()
    for (const spec of result.specifications) {
      // Reuse an existing env spec by name within this library; otherwise
      // insert. This keeps re-imports idempotent.
      const existingSpec = await lookupSpecId(q, newLibId, spec.name)
      if (existingSpec) {
        specIdsByName.set(spec.name, existingSpec)
        continue
      }
      const newSpecId = await insertSpec(q, {
        libraryId: newLibId,
        name: spec.name,
        description: spec.description ?? null,
        data: spec.data,
      })
      specIdsByName.set(spec.name, newSpecId)
    }
    envSpecIdsByLibraryAndName.set(lib.name, specIdsByName)
  }

  return {
    envLibraryIdsByName,
    actionLibraryIdsByName,
    envSpecIdsByLibraryAndName,
    envLibrariesCreated,
    envLibrariesReused,
    actionLibrariesCreated,
    actionLibrariesReused,
    warnings,
  }
}
