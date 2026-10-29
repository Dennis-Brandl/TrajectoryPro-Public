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

// Direct-DB seed for the RBAC personas spec. The v2 API has no "create spec"
// endpoint (content is authored via batch-save); for an AUTHZ test we want root
// specs in PRECISE lifecycle states, so we insert them straight into the same
// e2e DB the server uses (DATABASE_URL). Libraries are still created through the
// real POST /api/v2/libraries (helpers/admin.ts createLibrary). data='{}' is
// valid JSON and enough — the UI tests touch only the tree row + Change-State
// dialog, never the canvas.

import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'

/** A pg Pool connected to the e2e DB (DATABASE_URL). Caller may call pool.end() when done. */
export function openWritableDb(): Pool {
  const connStr = process.env.DATABASE_URL
  if (!connStr) {
    throw new Error("DATABASE_URL is not set. Run via 'npx playwright test' from the repo root.")
  }
  return new Pool({ connectionString: connStr, allowExitOnIdle: true })
}

/**
 * Insert a ROOT specification (parentSpecificationId NULL, rootSpecificationId =
 * own id — the DB self-referential convention) in the given lifecycle state.
 * `data` is written verbatim as the spec's `data` JSON (nodes/edges/etc. live
 * here); omit it for an empty `{}` spec. Returns the new spec id.
 */
export async function seedRootSpec(
  db: Pool,
  opts: { libraryId: string; name: string; state: string; version?: string; data?: Record<string, unknown> },
): Promise<string> {
  const id = randomUUID()
  const now = Date.now()
  await db.query(
    `INSERT INTO "specification"
       ("id", "libraryId", "name", "version", "state", "data", "createdAt", "updatedAt",
        "rootSpecificationId", "dataSchemaVersion", "history")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 3, '[]')`,
    [id, opts.libraryId, opts.name, opts.version ?? '1.0.0', opts.state, JSON.stringify(opts.data ?? {}), now, now, id],
  )
  return id
}
