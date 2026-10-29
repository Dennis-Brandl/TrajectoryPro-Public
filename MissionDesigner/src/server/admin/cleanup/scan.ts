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
import { db, rawQuery } from '../../lib/db'
import { library, specification, user, proxyReference } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { detectAll } from './detectors'
import { reportCache } from './reportCache'
import { cleanupMutex } from './mutex'
import type { DriftType, Finding, ScanEvent, ScanReport, SpecRow, ProxyRefRow } from './types'

export async function* scanAll(): AsyncGenerator<ScanEvent> {
  if (!cleanupMutex.acquire()) {
    yield { type: 'error', message: 'A cleanup scan or apply is already in progress.' }
    return
  }
  try {
    const libraries = await db
      .select({
        id: library.id,
        name: library.name,
        userEmail: user.email,
      })
      .from(library)
      .leftJoin(user, eq(library.createdByUserId, user.id))

    const [totalSpecsRow] = await rawQuery<{ c: string }>('SELECT COUNT(*) as c FROM specification')
    const totalSpecs = Number(totalSpecsRow.c) // I2: COUNT(*) returns bigint string in PG
    yield { type: 'start', totalLibraries: libraries.length, totalSpecs }

    const specExistsAll = new Set<string>(
      (await rawQuery<{ id: string }>('SELECT id FROM specification')).map((r) => r.id),
    )

    let specsDone = 0
    let librariesDone = 0
    const allFindings: Finding[] = []

    for (const lib of libraries) {
      const specs = (await db
        .select({
          id: specification.id,
          name: specification.name,
          data: specification.data,
          parentSpecificationId: specification.parentSpecificationId,
          rootSpecificationId: specification.rootSpecificationId,
        })
        .from(specification)
        .where(eq(specification.libraryId, lib.id))) as SpecRow[]

      const proxyRefs = (await db
        .select({
          parentSpecificationId: proxyReference.parentSpecificationId,
          nodeId: proxyReference.nodeId,
          targetSpecificationId: proxyReference.targetSpecificationId,
        })
        .from(proxyReference)
        .innerJoin(specification, eq(proxyReference.parentSpecificationId, specification.id))
        .where(eq(specification.libraryId, lib.id))) as ProxyRefRow[]

      const descendantCounts = computeDescendantCounts(specs)

      const findings = detectAll({
        libraryId: lib.id,
        libraryName: lib.name,
        userEmail: lib.userEmail ?? '(unknown)',
        specs,
        proxyRefs,
        specExists: specExistsAll,
        descendantCounts,
      })
      allFindings.push(...findings)

      specsDone += specs.length
      librariesDone += 1
      yield {
        type: 'progress',
        librariesDone,
        librariesTotal: libraries.length,
        specsDone,
        specsTotal: totalSpecs,
        currentLibraryName: lib.name,
        currentUserEmail: lib.userEmail ?? '(unknown)',
      }
    }

    const summary = summarize(allFindings)
    const report: ScanReport = {
      scanId: randomUUID(),
      createdAt: Date.now(),
      findings: allFindings,
      summary,
    }
    reportCache.set(report)
    yield { type: 'result', scanId: report.scanId, findings: allFindings, summary }
  } catch (err) {
    yield { type: 'error', message: err instanceof Error ? err.message : String(err) }
  } finally {
    cleanupMutex.release()
  }
}

function computeDescendantCounts(specs: SpecRow[]): Map<string, number> {
  const childrenByParent = new Map<string, string[]>()
  for (const s of specs) {
    if (!s.parentSpecificationId) continue
    let list = childrenByParent.get(s.parentSpecificationId)
    if (!list) {
      list = []
      childrenByParent.set(s.parentSpecificationId, list)
    }
    list.push(s.id)
  }
  const memo = new Map<string, number>()
  const count = (id: string): number => {
    if (memo.has(id)) return memo.get(id)!
    const kids = childrenByParent.get(id) ?? []
    let n = kids.length
    for (const k of kids) n += count(k)
    memo.set(id, n)
    return n
  }
  for (const s of specs) memo.set(s.id, count(s.id))
  return memo
}

function summarize(findings: Finding[]) {
  const byType: Record<DriftType, number> = { D1: 0, D2: 0, D3: 0, D4: 0, D5: 0, D6: 0 }
  let totalReportOnly = 0
  for (const f of findings) {
    byType[f.driftType] += 1
    if (f.driftType === 'D5' || f.driftType === 'D6') totalReportOnly += 1
  }
  return { byType, totalReportOnly }
}
