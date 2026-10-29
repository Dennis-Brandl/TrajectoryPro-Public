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
import type { D1Finding, D2Finding, D3Finding, D4Finding, D5Finding, D6Finding, DetectorInput, Finding } from './types'
import { parseWorkflowProxies } from './parseWorkflowProxies'

export function detectD1(input: DetectorInput): D1Finding[] {
  const { libraryId, libraryName, userEmail, specs, descendantCounts } = input
  const specsById = new Map(specs.map((s) => [s.id, s]))

  // For each parent spec, compute the set of embeddedWorkflowSpecIds its diagram references.
  const embeddedByParent = new Map<string, Set<string>>()
  for (const p of specs) {
    const proxies = parseWorkflowProxies(p.id, p.data)
    const embedded = new Set<string>()
    for (const n of proxies) {
      if (n.subWorkflowMode === 'embedded' && n.embeddedWorkflowSpecId) {
        embedded.add(n.embeddedWorkflowSpecId)
      }
    }
    embeddedByParent.set(p.id, embedded)
  }

  const findings: D1Finding[] = []
  for (const c of specs) {
    if (!c.parentSpecificationId) continue
    const dbParent = specsById.get(c.parentSpecificationId)
    if (!dbParent) continue // DB parent missing — this is a data integrity issue but not D1
    const embedded = embeddedByParent.get(dbParent.id) ?? new Set<string>()
    if (embedded.has(c.id)) continue
    findings.push({
      id: randomUUID(),
      driftType: 'D1',
      libraryId,
      libraryName,
      userEmail,
      orphanSpecId: c.id,
      orphanSpecName: c.name,
      dbParentId: c.parentSpecificationId,
      descendantCount: descendantCounts.get(c.id) ?? 0,
    })
  }
  return findings
}

export function detectD2(input: DetectorInput): D2Finding[] {
  const { libraryId, libraryName, userEmail, specs } = input
  const specsById = new Map(specs.map((s) => [s.id, s]))

  const findings: D2Finding[] = []
  for (const p of specs) {
    const proxies = parseWorkflowProxies(p.id, p.data)
    for (const n of proxies) {
      if (n.subWorkflowMode !== 'embedded' || !n.embeddedWorkflowSpecId) continue
      const child = specsById.get(n.embeddedWorkflowSpecId)
      if (!child) continue // child missing → D5, not D2
      if (child.parentSpecificationId === p.id) continue
      findings.push({
        id: randomUUID(),
        driftType: 'D2',
        libraryId,
        libraryName,
        userEmail,
        childSpecId: child.id,
        childSpecName: child.name,
        diagramParentId: p.id,
        dbParentId: child.parentSpecificationId,
      })
    }
  }
  return findings
}

export function detectD3(input: DetectorInput): D3Finding[] {
  const { libraryId, libraryName, userEmail, specs, proxyRefs } = input

  // For each parent spec, build a Map<nodeId, referencedStepSpecId> from the diagram.
  const diagramRefsByParent = new Map<string, Map<string, string>>()
  for (const p of specs) {
    const m = new Map<string, string>()
    for (const n of parseWorkflowProxies(p.id, p.data)) {
      if (n.subWorkflowMode === 'reference' && n.referencedStepSpecId) {
        m.set(n.nodeId, n.referencedStepSpecId)
      }
    }
    diagramRefsByParent.set(p.id, m)
  }

  const findings: D3Finding[] = []
  for (const row of proxyRefs) {
    const diagramMap = diagramRefsByParent.get(row.parentSpecificationId)
    const diagramTarget = diagramMap?.get(row.nodeId)
    if (diagramTarget === row.targetSpecificationId) continue
    findings.push({
      id: randomUUID(),
      driftType: 'D3',
      libraryId,
      libraryName,
      userEmail,
      parentSpecId: row.parentSpecificationId,
      nodeId: row.nodeId,
      targetSpecId: row.targetSpecificationId,
    })
  }
  return findings
}

export function detectD4(input: DetectorInput): D4Finding[] {
  const { libraryId, libraryName, userEmail, specs, proxyRefs, specExists } = input

  const rowsByParent = new Map<string, Map<string, string>>()
  for (const r of proxyRefs) {
    let m = rowsByParent.get(r.parentSpecificationId)
    if (!m) {
      m = new Map()
      rowsByParent.set(r.parentSpecificationId, m)
    }
    m.set(r.nodeId, r.targetSpecificationId)
  }

  const findings: D4Finding[] = []
  for (const p of specs) {
    const rows = rowsByParent.get(p.id) ?? new Map<string, string>()
    for (const n of parseWorkflowProxies(p.id, p.data)) {
      if (n.subWorkflowMode !== 'reference' || !n.referencedStepSpecId) continue
      if (!specExists.has(n.referencedStepSpecId)) continue // D6 territory
      if (rows.get(n.nodeId) === n.referencedStepSpecId) continue // row already present
      findings.push({
        id: randomUUID(),
        driftType: 'D4',
        libraryId,
        libraryName,
        userEmail,
        parentSpecId: p.id,
        nodeId: n.nodeId,
        targetSpecId: n.referencedStepSpecId,
      })
    }
  }
  return findings
}

export function detectD5(input: DetectorInput): D5Finding[] {
  const { libraryId, libraryName, userEmail, specs, specExists } = input
  const findings: D5Finding[] = []
  for (const p of specs) {
    for (const n of parseWorkflowProxies(p.id, p.data)) {
      if (n.subWorkflowMode !== 'embedded' || !n.embeddedWorkflowSpecId) continue
      if (specExists.has(n.embeddedWorkflowSpecId)) continue
      findings.push({
        id: randomUUID(),
        driftType: 'D5',
        libraryId,
        libraryName,
        userEmail,
        parentSpecId: p.id,
        nodeId: n.nodeId,
        missingTargetId: n.embeddedWorkflowSpecId,
      })
    }
  }
  return findings
}

export function detectD6(input: DetectorInput): D6Finding[] {
  const { libraryId, libraryName, userEmail, specs, specExists } = input
  const findings: D6Finding[] = []
  for (const p of specs) {
    for (const n of parseWorkflowProxies(p.id, p.data)) {
      if (n.subWorkflowMode !== 'reference' || !n.referencedStepSpecId) continue
      if (specExists.has(n.referencedStepSpecId)) continue
      findings.push({
        id: randomUUID(),
        driftType: 'D6',
        libraryId,
        libraryName,
        userEmail,
        parentSpecId: p.id,
        nodeId: n.nodeId,
        missingTargetId: n.referencedStepSpecId,
      })
    }
  }
  return findings
}

export function detectAll(input: DetectorInput): Finding[] {
  return [
    ...detectD1(input),
    ...detectD2(input),
    ...detectD3(input),
    ...detectD4(input),
    ...detectD5(input),
    ...detectD6(input),
  ]
}
