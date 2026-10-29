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

import { describe, it, expect } from 'vitest'
import { detectD1, detectD2, detectD3, detectD4, detectD5, detectD6 } from '../detectors'
import type { DetectorInput, SpecRow } from '../types'

const mkInput = (overrides: Partial<DetectorInput> = {}): DetectorInput => ({
  libraryId: 'lib',
  libraryName: 'Lib',
  userEmail: 'u@x.com',
  specs: [],
  proxyRefs: [],
  specExists: new Set(),
  descendantCounts: new Map(),
  ...overrides,
})

const mkSpec = (id: string, data: object, parent: string | null = null, name = id): SpecRow => ({
  id,
  name,
  data: JSON.stringify(data),
  parentSpecificationId: parent,
  rootSpecificationId: parent ?? id,
})

describe('detectD1 — orphan embedded child', () => {
  it('flags a child whose DB parent does not reference it in its diagram', () => {
    const parent = mkSpec('P', { nodes: [] })
    const orphan = mkSpec('C', { nodes: [] }, 'P', 'Draft')
    const findings = detectD1(mkInput({ specs: [parent, orphan], descendantCounts: new Map([['C', 3]]) }))
    expect(findings).toHaveLength(1)
    const f = findings[0]
    expect(f.driftType).toBe('D1')
    if (f.driftType !== 'D1') throw new Error('typeguard')
    expect(f.orphanSpecId).toBe('C')
    expect(f.orphanSpecName).toBe('Draft')
    expect(f.dbParentId).toBe('P')
    expect(f.descendantCount).toBe(3)
    expect(f.libraryId).toBe('lib')
  })

  it('does not flag when parent diagram references the child embedded', () => {
    const parent = mkSpec('P', {
      nodes: [{ id: 'n1', type: 'workflowProxy', data: { subWorkflowMode: 'embedded', embeddedWorkflowSpecId: 'C' } }],
    })
    const child = mkSpec('C', { nodes: [] }, 'P')
    expect(detectD1(mkInput({ specs: [parent, child] }))).toEqual([])
  })

  it('does not flag root specs (no parent)', () => {
    expect(detectD1(mkInput({ specs: [mkSpec('R', { nodes: [] }, null)] }))).toEqual([])
  })

  it('does not flag when the DB parent does not exist (D5 territory)', () => {
    const orphan = mkSpec('C', { nodes: [] }, 'GONE')
    expect(detectD1(mkInput({ specs: [orphan] }))).toEqual([])
  })
})

describe('detectD2 — re-parented embedded child', () => {
  const parent = (id: string, children: string[]) =>
    mkSpec(id, {
      nodes: children.map((c, i) => ({
        id: `n${i}`,
        type: 'workflowProxy',
        data: { subWorkflowMode: 'embedded', embeddedWorkflowSpecId: c },
      })),
    })

  it('flags a child whose diagram parent differs from DB parent', () => {
    const findings = detectD2(mkInput({ specs: [parent('P', ['C']), mkSpec('C', { nodes: [] }, 'OTHER')] }))
    expect(findings).toHaveLength(1)
    if (findings[0].driftType !== 'D2') throw new Error('typeguard')
    expect(findings[0].childSpecId).toBe('C')
    expect(findings[0].diagramParentId).toBe('P')
    expect(findings[0].dbParentId).toBe('OTHER')
  })

  it('flags a child with null DB parent when diagram references it', () => {
    const findings = detectD2(mkInput({ specs: [parent('P', ['C']), mkSpec('C', { nodes: [] }, null)] }))
    expect(findings).toHaveLength(1)
    if (findings[0].driftType !== 'D2') throw new Error('typeguard')
    expect(findings[0].dbParentId).toBeNull()
  })

  it('does not flag when diagram and DB agree', () => {
    expect(detectD2(mkInput({ specs: [parent('P', ['C']), mkSpec('C', { nodes: [] }, 'P')] }))).toEqual([])
  })

  it('does not flag when diagram references a spec that does not exist (D5)', () => {
    expect(detectD2(mkInput({ specs: [parent('P', ['GONE'])] }))).toEqual([])
  })
})

describe('detectD3 — stale proxy_reference row', () => {
  const parentWithRef = (specId: string, nodeId: string, target: string) =>
    mkSpec(specId, {
      nodes: [
        { id: nodeId, type: 'workflowProxy', data: { subWorkflowMode: 'reference', referencedStepSpecId: target } },
      ],
    })

  it('flags a row with no matching diagram node', () => {
    const findings = detectD3(
      mkInput({
        specs: [mkSpec('P', { nodes: [] })],
        proxyRefs: [{ parentSpecificationId: 'P', nodeId: 'gone', targetSpecificationId: 'T' }],
      }),
    )
    expect(findings).toHaveLength(1)
    if (findings[0].driftType !== 'D3') throw new Error('typeguard')
    expect(findings[0].parentSpecId).toBe('P')
    expect(findings[0].nodeId).toBe('gone')
    expect(findings[0].targetSpecId).toBe('T')
  })

  it('flags a row where node exists but target differs', () => {
    const findings = detectD3(
      mkInput({
        specs: [parentWithRef('P', 'n1', 'NEW_TARGET')],
        proxyRefs: [{ parentSpecificationId: 'P', nodeId: 'n1', targetSpecificationId: 'OLD_TARGET' }],
      }),
    )
    expect(findings).toHaveLength(1)
  })

  it('does not flag when diagram and row agree', () => {
    expect(
      detectD3(
        mkInput({
          specs: [parentWithRef('P', 'n1', 'T')],
          proxyRefs: [{ parentSpecificationId: 'P', nodeId: 'n1', targetSpecificationId: 'T' }],
        }),
      ),
    ).toEqual([])
  })
})

describe('detectD4 — missing proxy_reference row', () => {
  const parentRef = (target: string) =>
    mkSpec('P', {
      nodes: [
        { id: 'n1', type: 'workflowProxy', data: { subWorkflowMode: 'reference', referencedStepSpecId: target } },
      ],
    })

  it('flags when row is missing and target exists', () => {
    const findings = detectD4(mkInput({ specs: [parentRef('T')], specExists: new Set(['T']), proxyRefs: [] }))
    expect(findings).toHaveLength(1)
    if (findings[0].driftType !== 'D4') throw new Error('typeguard')
    expect(findings[0].parentSpecId).toBe('P')
    expect(findings[0].nodeId).toBe('n1')
    expect(findings[0].targetSpecId).toBe('T')
  })

  it('does not flag when target does not exist (D6 territory)', () => {
    expect(detectD4(mkInput({ specs: [parentRef('GONE')], specExists: new Set() }))).toEqual([])
  })

  it('does not flag when row already exists', () => {
    expect(
      detectD4(
        mkInput({
          specs: [parentRef('T')],
          specExists: new Set(['T']),
          proxyRefs: [{ parentSpecificationId: 'P', nodeId: 'n1', targetSpecificationId: 'T' }],
        }),
      ),
    ).toEqual([])
  })
})

describe('detectD5 — dangling embedded target', () => {
  it('flags an embedded proxy whose target does not exist', () => {
    const parent = mkSpec('P', {
      nodes: [
        { id: 'n1', type: 'workflowProxy', data: { subWorkflowMode: 'embedded', embeddedWorkflowSpecId: 'GONE' } },
      ],
    })
    const findings = detectD5(mkInput({ specs: [parent], specExists: new Set(['P']) }))
    expect(findings).toHaveLength(1)
    if (findings[0].driftType !== 'D5') throw new Error('typeguard')
    expect(findings[0].missingTargetId).toBe('GONE')
    expect(findings[0].nodeId).toBe('n1')
  })

  it('does not flag when target exists', () => {
    const parent = mkSpec('P', {
      nodes: [{ id: 'n1', type: 'workflowProxy', data: { subWorkflowMode: 'embedded', embeddedWorkflowSpecId: 'C' } }],
    })
    expect(detectD5(mkInput({ specs: [parent], specExists: new Set(['P', 'C']) }))).toEqual([])
  })
})

describe('detectD6 — dangling reference target', () => {
  it('flags a reference proxy whose target does not exist', () => {
    const parent = mkSpec('P', {
      nodes: [
        { id: 'n1', type: 'workflowProxy', data: { subWorkflowMode: 'reference', referencedStepSpecId: 'GONE' } },
      ],
    })
    const findings = detectD6(mkInput({ specs: [parent], specExists: new Set(['P']) }))
    expect(findings).toHaveLength(1)
    if (findings[0].driftType !== 'D6') throw new Error('typeguard')
    expect(findings[0].missingTargetId).toBe('GONE')
  })

  it('does not flag when target exists', () => {
    const parent = mkSpec('P', {
      nodes: [{ id: 'n1', type: 'workflowProxy', data: { subWorkflowMode: 'reference', referencedStepSpecId: 'T' } }],
    })
    expect(detectD6(mkInput({ specs: [parent], specExists: new Set(['P', 'T']) }))).toEqual([])
  })
})
