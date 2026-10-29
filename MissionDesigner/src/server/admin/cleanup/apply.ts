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

import { withTransaction } from '../../lib/db'
import type { ApplyResult, D1Finding, D2Finding, D3Finding, D4Finding, Finding, ScanReport } from './types'
import { parseWorkflowProxies } from './parseWorkflowProxies'

const ORDER: Record<Finding['driftType'], number> = { D3: 0, D4: 1, D2: 2, D1: 3, D5: 99, D6: 99 }

export async function applyFindings(report: ScanReport, findingIds: string[]): Promise<ApplyResult[]> {
  const byId = new Map(report.findings.map((f) => [f.id, f]))
  const selected: Finding[] = []
  for (const id of findingIds) {
    const f = byId.get(id)
    if (f) selected.push(f)
  }
  selected.sort((a, b) => ORDER[a.driftType] - ORDER[b.driftType])
  const results: ApplyResult[] = []
  for (const f of selected) {
    results.push(await applyOne(f))
  }
  return results
}

async function applyOne(finding: Finding): Promise<ApplyResult> {
  try {
    switch (finding.driftType) {
      case 'D1':
        return await applyD1(finding)
      case 'D2':
        return await applyD2(finding)
      case 'D3':
        return await applyD3(finding)
      case 'D4':
        return await applyD4(finding)
      case 'D5':
      case 'D6':
        return { findingId: finding.id, result: 'skipped', message: 'Report-only drift type' } as ApplyResult
    }
  } catch (err) {
    return {
      findingId: finding.id,
      result: 'failed',
      message: err instanceof Error ? err.message : String(err),
    }
  }
}

async function applyD3(f: D3Finding): Promise<ApplyResult> {
  return withTransaction(async (q) => {
    const existing = await q(
      'SELECT 1 FROM "proxy_reference" WHERE "parentSpecificationId" = $1 AND "nodeId" = $2 AND "targetSpecificationId" = $3',
      [f.parentSpecId, f.nodeId, f.targetSpecId],
    )
    if (!existing.length) return { findingId: f.id, result: 'skipped', message: 'resolved-before-apply' }
    await q(
      'DELETE FROM "proxy_reference" WHERE "parentSpecificationId" = $1 AND "nodeId" = $2 AND "targetSpecificationId" = $3',
      [f.parentSpecId, f.nodeId, f.targetSpecId],
    )
    return { findingId: f.id, result: 'applied' }
  })
}

async function applyD4(f: D4Finding): Promise<ApplyResult> {
  return withTransaction(async (q) => {
    const [parent] = await q<{ data: string }>('SELECT data FROM specification WHERE id = $1', [f.parentSpecId])
    if (!parent) return { findingId: f.id, result: 'skipped', message: 'parent no longer exists' }
    const nodes = parseWorkflowProxies(f.parentSpecId, parent.data)
    const match = nodes.find(
      (n) => n.nodeId === f.nodeId && n.subWorkflowMode === 'reference' && n.referencedStepSpecId === f.targetSpecId,
    )
    if (!match) return { findingId: f.id, result: 'skipped', message: 'resolved-before-apply' }
    const [target] = await q<{ id: string }>('SELECT id FROM specification WHERE id = $1', [f.targetSpecId])
    if (!target) return { findingId: f.id, result: 'skipped', message: 'target no longer exists' }
    const existing = await q('SELECT 1 FROM "proxy_reference" WHERE "parentSpecificationId" = $1 AND "nodeId" = $2', [
      f.parentSpecId,
      f.nodeId,
    ])
    if (existing.length) return { findingId: f.id, result: 'skipped', message: 'resolved-before-apply' }
    await q(
      'INSERT INTO "proxy_reference" ("parentSpecificationId", "nodeId", "targetSpecificationId") VALUES ($1, $2, $3)',
      [f.parentSpecId, f.nodeId, f.targetSpecId],
    )
    return { findingId: f.id, result: 'applied' }
  })
}

// Full spec row as returned from Postgres via rawQuery/q.
// bigint columns (createdAt, updatedAt, effectiveFrom) come back as strings — use Number() before arithmetic.
type RawSpecRow = {
  id: string
  libraryId: string
  name: string
  description: string | null
  typeName: string | null
  version: string
  state: string
  data: string
  environmentLibraryIds: string | null
  createdAt: string // PG bigint → string (I2)
  updatedAt: string // PG bigint → string (I2)
  dataSchemaVersion: number
  lastEditedByUserId: string | null
  parentSpecificationId: string | null
  rootSpecificationId: string | null
  history: string
  effectiveFrom: string | null // PG bigint → string | null (I2)
}
type ProxyRefRow = { parentSpecificationId: string; nodeId: string; targetSpecificationId: string }

// Shared type for the withTransaction q parameter.
type TxQ = <R = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>

async function applyD2(f: D2Finding): Promise<ApplyResult> {
  return withTransaction(async (q) => {
    // Re-verify the child still exists and drift hasn't been resolved externally.
    const [childRow] = await q<RawSpecRow>(
      `SELECT id, "libraryId", name, description, "typeName", version, state, data, "environmentLibraryIds",
              "createdAt", "updatedAt", "dataSchemaVersion", "lastEditedByUserId",
              "parentSpecificationId", "rootSpecificationId", history, "effectiveFrom"
       FROM specification WHERE id = $1`,
      [f.childSpecId],
    )
    if (!childRow) return { findingId: f.id, result: 'skipped', message: 'child no longer exists' }
    if (childRow.parentSpecificationId === f.diagramParentId)
      return { findingId: f.id, result: 'skipped', message: 'resolved-before-apply' }

    // Compute new rootSpecificationId: follow the diagramParent chain upward.
    const newRoot = await findRootWithQ(q, f.diagramParentId)

    // Collect the entire subtree rooted at childSpecId via BFS.
    // BFS naturally yields parent-first topological order for re-insertion.
    const subtreeIds: string[] = []
    const queue: string[] = [f.childSpecId]
    while (queue.length > 0) {
      const current = queue.shift()!
      subtreeIds.push(current)
      const children = await q<{ id: string }>('SELECT id FROM specification WHERE "parentSpecificationId" = $1', [
        current,
      ])
      for (const c of children) queue.push(c.id)
    }

    // Snapshot every specification row in the subtree.
    const specSnapshots = new Map<string, RawSpecRow>()
    for (const id of subtreeIds) {
      const [row] = await q<RawSpecRow>(
        `SELECT id, "libraryId", name, description, "typeName", version, state, data, "environmentLibraryIds",
                "createdAt", "updatedAt", "dataSchemaVersion", "lastEditedByUserId",
                "parentSpecificationId", "rootSpecificationId", history, "effectiveFrom"
         FROM specification WHERE id = $1`,
        [id],
      )
      specSnapshots.set(id, row)
    }

    // Snapshot proxy_reference rows:
    //   - Outbound: parentSpecificationId IN subtree (CASCADE would wipe these on delete).
    //   - Inbound:  targetSpecificationId IN subtree (RESTRICT would block the root delete).
    // Collect all unique rows by (parentSpecificationId, nodeId) key.
    const proxyRefMap = new Map<string, ProxyRefRow>()
    const addRef = (row: ProxyRefRow) => {
      proxyRefMap.set(`${row.parentSpecificationId}::${row.nodeId}`, row)
    }

    for (const id of subtreeIds) {
      // Outbound refs from this subtree member.
      const outbound = await q<ProxyRefRow>(
        'SELECT "parentSpecificationId", "nodeId", "targetSpecificationId" FROM "proxy_reference" WHERE "parentSpecificationId" = $1',
        [id],
      )
      for (const r of outbound) addRef(r)

      // Inbound refs targeting this subtree member.
      const inbound = await q<ProxyRefRow>(
        'SELECT "parentSpecificationId", "nodeId", "targetSpecificationId" FROM "proxy_reference" WHERE "targetSpecificationId" = $1',
        [id],
      )
      for (const r of inbound) addRef(r)
    }
    const allProxyRefs = Array.from(proxyRefMap.values())

    // DELETE phase — must remove inbound refs first (RESTRICT blocks deletes otherwise).
    // Outbound refs from within the subtree will be CASCADE-deleted when the root is deleted.
    for (const ref of allProxyRefs) {
      await q('DELETE FROM "proxy_reference" WHERE "parentSpecificationId" = $1 AND "nodeId" = $2', [
        ref.parentSpecificationId,
        ref.nodeId,
      ])
    }

    // Delete the subtree root — CASCADE wipes all descendants and their outbound proxy_references.
    await q('DELETE FROM specification WHERE id = $1', [f.childSpecId])

    // RE-INSERT phase — parent-first order (BFS guarantees this).
    const now = Date.now()
    for (const id of subtreeIds) {
      const s = specSnapshots.get(id)!
      const isRoot = id === f.childSpecId
      await q(
        `INSERT INTO specification
           (id, "libraryId", name, description, "typeName", version, state, data, "environmentLibraryIds",
            "createdAt", "updatedAt", "dataSchemaVersion", "lastEditedByUserId",
            "parentSpecificationId", "rootSpecificationId", history, "effectiveFrom")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [
          s.id,
          s.libraryId,
          s.name,
          s.description,
          s.typeName,
          s.version,
          s.state,
          s.data,
          s.environmentLibraryIds,
          Number(s.createdAt), // I2: bigint from PG rawQuery
          // Only bump updatedAt for the subtree root being re-parented; descendants are logically untouched.
          isRoot ? now : Number(s.updatedAt), // I2: bigint from PG rawQuery
          s.dataSchemaVersion,
          s.lastEditedByUserId,
          // Subtree root gets new parent; descendants keep their existing parentSpecificationId.
          isRoot ? f.diagramParentId : s.parentSpecificationId,
          newRoot,
          s.history,
          s.effectiveFrom !== null ? Number(s.effectiveFrom) : null, // I2: bigint from PG rawQuery
        ],
      )
    }

    // Restore all proxy_reference rows.
    for (const ref of allProxyRefs) {
      await q(
        'INSERT INTO "proxy_reference" ("parentSpecificationId", "nodeId", "targetSpecificationId") VALUES ($1, $2, $3)',
        [ref.parentSpecificationId, ref.nodeId, ref.targetSpecificationId],
      )
    }

    return { findingId: f.id, result: 'applied' }
  })
}

async function findRootWithQ(q: TxQ, specId: string): Promise<string> {
  let current = specId
  // Bounded walk to avoid infinite loops on bad data.
  for (let i = 0; i < 128; i++) {
    const [row] = await q<{ parentSpecificationId: string | null }>(
      'SELECT "parentSpecificationId" FROM specification WHERE id = $1',
      [current],
    )
    if (!row || !row.parentSpecificationId) return current
    current = row.parentSpecificationId
  }
  throw new Error(`parent chain too deep starting at ${specId}`)
}

async function applyD1(f: D1Finding): Promise<ApplyResult> {
  return withTransaction(async (q) => {
    const [child] = await q<{ parentSpecificationId: string | null }>(
      'SELECT "parentSpecificationId" FROM specification WHERE id = $1',
      [f.orphanSpecId],
    )
    if (!child) return { findingId: f.id, result: 'skipped', message: 'already deleted' }
    if (child.parentSpecificationId !== f.dbParentId)
      return { findingId: f.id, result: 'skipped', message: 'resolved-before-apply' }
    // Re-confirm parent diagram still does NOT reference this child.
    const [parent] = await q<{ data: string }>('SELECT data FROM specification WHERE id = $1', [f.dbParentId])
    if (parent) {
      const referenced = parseWorkflowProxies(f.dbParentId, parent.data).some(
        (n) => n.subWorkflowMode === 'embedded' && n.embeddedWorkflowSpecId === f.orphanSpecId,
      )
      if (referenced) return { findingId: f.id, result: 'skipped', message: 'resolved-before-apply' }
    }
    await q('DELETE FROM specification WHERE id = $1', [f.orphanSpecId])
    return { findingId: f.id, result: 'applied' }
  })
}
