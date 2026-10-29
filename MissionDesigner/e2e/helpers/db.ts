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

import { Pool } from 'pg'

/**
 * Projected columns only — NOT all library columns from schema.ts.
 * If you need an additional field (e.g. changeHistory), add it to
 * BOTH this interface and the SELECT lists in the query functions below.
 * Adding only to the interface will silently produce `undefined` at runtime.
 */
export interface LibraryRow {
  id: string
  teamId: string
  parentLibraryId: string | null
  name: string
  entityType: string
  description: string | null
  author: string | null
  version: string
  createdAt: number
  updatedAt: number
}

/**
 * Projected columns only — NOT all specification columns from schema.ts.
 * If you need an additional field (e.g. environmentLibraryIds, lastEditedByUserId),
 * add it to BOTH this interface and the SELECT lists in the query functions below.
 * Adding only to the interface will silently produce `undefined` at runtime.
 */
export interface SpecRow {
  id: string
  libraryId: string
  name: string
  description: string | null
  version: string
  state: string
  data: string // JSON string
  parentSpecificationId: string | null
  rootSpecificationId: string | null
  dataSchemaVersion: number
  createdAt: number
  updatedAt: number
}

export interface ProxyRow {
  parentSpecificationId: string
  nodeId: string
  targetSpecificationId: string
}

export interface SubtreeRow extends SpecRow {
  depth: number
}

let db: Pool | null = null

/**
 * Open (or return the cached) pg Pool for the e2e database. The connection
 * string comes from DATABASE_URL (set by playwright.config for both the server
 * child and this runner process), so db.ts always connects to the SAME
 * disposable database the server writes, never the dev/container trajectory DB.
 * `allowExitOnIdle: true` lets the Playwright runner process exit cleanly
 * without an explicit pool.end().
 */
export function openDb(): Pool {
  if (db) return db
  const connStr = process.env.DATABASE_URL
  if (!connStr) {
    throw new Error("DATABASE_URL is not set. Run via 'npx playwright test' from the repo root.")
  }
  db = new Pool({ connectionString: connStr, allowExitOnIdle: true })
  return db
}

export async function closeDb(): Promise<void> {
  if (db) {
    await db.end()
    db = null
  }
}

export async function getLibraryByName(teamId: string, name: string, entityType = 'step'): Promise<LibraryRow | null> {
  const { rows } = await openDb().query(
    `SELECT id, "teamId", "parentLibraryId", name, "entityType", description, author, version, "createdAt", "updatedAt"
       FROM library
      WHERE "teamId" = $1 AND name = $2 AND "entityType" = $3
      LIMIT 1`,
    [teamId, name, entityType],
  )
  const r = rows[0]
  if (!r) return null
  return { ...r, createdAt: Number(r.createdAt), updatedAt: Number(r.updatedAt) }
}

export async function getLibrariesForTeam(teamId: string, entityType = 'step'): Promise<LibraryRow[]> {
  const { rows } = await openDb().query(
    `SELECT id, "teamId", "parentLibraryId", name, "entityType", description, author, version, "createdAt", "updatedAt"
       FROM library
      WHERE "teamId" = $1 AND "entityType" = $2
      ORDER BY "createdAt" ASC`,
    [teamId, entityType],
  )
  return rows.map((r) => ({ ...r, createdAt: Number(r.createdAt), updatedAt: Number(r.updatedAt) }))
}

export async function getLibraryById(id: string): Promise<LibraryRow | null> {
  const { rows } = await openDb().query(
    `SELECT id, "teamId", "parentLibraryId", name, "entityType", description, author, version, "createdAt", "updatedAt"
       FROM library
      WHERE id = $1`,
    [id],
  )
  const r = rows[0]
  if (!r) return null
  return { ...r, createdAt: Number(r.createdAt), updatedAt: Number(r.updatedAt) }
}

export async function getRootSpecs(libraryId: string): Promise<SpecRow[]> {
  const { rows } = await openDb().query(
    `SELECT id, "libraryId", name, description, version, state, data,
            "parentSpecificationId", "rootSpecificationId", "dataSchemaVersion", "createdAt", "updatedAt"
       FROM specification
      WHERE "libraryId" = $1 AND "parentSpecificationId" IS NULL
      ORDER BY "createdAt" ASC`,
    [libraryId],
  )
  return rows.map((r) => ({ ...r, createdAt: Number(r.createdAt), updatedAt: Number(r.updatedAt) }))
}

export async function getSpecById(id: string): Promise<SpecRow | null> {
  const { rows } = await openDb().query(
    `SELECT id, "libraryId", name, description, version, state, data,
            "parentSpecificationId", "rootSpecificationId", "dataSchemaVersion", "createdAt", "updatedAt"
       FROM specification
      WHERE id = $1`,
    [id],
  )
  const r = rows[0]
  if (!r) return null
  return { ...r, createdAt: Number(r.createdAt), updatedAt: Number(r.updatedAt) }
}

export async function getChildren(parentSpecId: string): Promise<SpecRow[]> {
  const { rows } = await openDb().query(
    `SELECT id, "libraryId", name, description, version, state, data,
            "parentSpecificationId", "rootSpecificationId", "dataSchemaVersion", "createdAt", "updatedAt"
       FROM specification
      WHERE "parentSpecificationId" = $1
      ORDER BY "createdAt" ASC`,
    [parentSpecId],
  )
  return rows.map((r) => ({ ...r, createdAt: Number(r.createdAt), updatedAt: Number(r.updatedAt) }))
}

export async function getFullSubtree(rootSpecId: string): Promise<SubtreeRow[]> {
  const { rows } = await openDb().query(
    `WITH RECURSIVE subtree AS (
       SELECT id, "libraryId", name, description, version, state, data,
              "parentSpecificationId", "rootSpecificationId", "dataSchemaVersion",
              "createdAt", "updatedAt", 0 AS depth
         FROM specification WHERE id = $1
       UNION ALL
       SELECT s.id, s."libraryId", s.name, s.description, s.version, s.state, s.data,
              s."parentSpecificationId", s."rootSpecificationId", s."dataSchemaVersion",
              s."createdAt", s."updatedAt", subtree.depth + 1
         FROM specification s
         JOIN subtree ON s."parentSpecificationId" = subtree.id
     )
     SELECT * FROM subtree ORDER BY depth, "createdAt"`,
    [rootSpecId],
  )
  return rows.map((r) => ({ ...r, createdAt: Number(r.createdAt), updatedAt: Number(r.updatedAt) }))
}

export async function getProxyReferences(parentSpecId: string): Promise<ProxyRow[]> {
  const { rows } = await openDb().query(
    `SELECT "parentSpecificationId", "nodeId", "targetSpecificationId"
       FROM proxy_reference
      WHERE "parentSpecificationId" = $1`,
    [parentSpecId],
  )
  return rows
}

/** Count proxy_reference rows whose parent or target is missing from specification. */
export async function countOrphanedProxyRefs(): Promise<number> {
  const { rows } = await openDb().query(
    `SELECT COUNT(*) AS n FROM proxy_reference pr
      WHERE NOT EXISTS (SELECT 1 FROM specification WHERE id = pr."parentSpecificationId")
         OR NOT EXISTS (SELECT 1 FROM specification WHERE id = pr."targetSpecificationId")`,
  )
  return Number(rows[0].n)
}

/** Parse the `data` JSON column of a specification row. */
export interface ParsedSpecData {
  inputs: Array<{ id: string; name: string; value?: string; valueType?: string; description?: string }>
  outputs: Array<{ id: string; name: string; description?: string }>
  values: Array<{ id: string; name: string; entries?: Array<{ key: string; value: string }> }>
  resourceCommands: Array<{
    id: string
    name: string
    resourceType: string
    count: number
    names?: string[]
    description?: string
  }>
  workflowInputs?: unknown[]
  workflowOutputs?: unknown[]
  workflowValues?: unknown[]
  workflowResources?: unknown[]
  nodes?: unknown[]
  edges?: unknown[]
  [key: string]: unknown
}

export function parseSpecData(spec: SpecRow): ParsedSpecData {
  const raw = JSON.parse(spec.data) as Partial<ParsedSpecData>
  return {
    inputs: [],
    outputs: [],
    values: [],
    resourceCommands: [],
    ...raw,
  } as ParsedSpecData
}
