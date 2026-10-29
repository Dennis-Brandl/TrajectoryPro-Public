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
import { buildImportPlan } from '@/server/packageFormat/buildImportPlan'
import type { ImportPlanRowStatus } from '@/types/wflibx-import'

const bundle = {
  bundleLibraryName: 'My Lib',
  oidIndex: {
    libraries: [
      { oid: 'L100', name: 'My Lib', entityType: 'workflow' as const, version: '1.0.0' },
      { oid: 'L200', name: 'Steps', entityType: 'step' as const, version: '1.0.0' },
    ],
    specifications: [
      { oid: 'S100', libraryOid: 'L100', name: 'Wf A', version: '1.0.0' },
      { oid: 'S200', libraryOid: 'L200', name: 'St A', version: '1.0.0' },
    ],
  },
  warnings: [],
}

function statusOf(row: { bundleOid: string; status: ImportPlanRowStatus }) {
  return row.status.tag
}

describe('buildImportPlan', () => {
  it('A) empty DB — every row is create', () => {
    const plan = buildImportPlan(bundle, { libraries: [], specifications: [] })
    expect(plan.rows.map(statusOf)).toEqual(['create', 'create', 'create', 'create'])
  })

  it('B) library exists, spec absent — spec gets add-to-existing', () => {
    const plan = buildImportPlan(bundle, {
      libraries: [{ id: 'L999', name: 'My Lib', entityType: 'workflow' }],
      specifications: [],
    })
    const wfLibRow = plan.rows.find((r) => r.bundleOid === 'L100')!
    expect(wfLibRow.status.tag).toBe('conflict')
    const wfSpecRow = plan.rows.find((r) => r.bundleOid === 'S100')!
    // When the library is conflict (kept), spec inside the existing library:
    expect(wfSpecRow.status.tag).toBe('add-to-existing')
  })

  it('C) same name, different OID — conflict', () => {
    const plan = buildImportPlan(bundle, {
      libraries: [
        { id: 'L999', name: 'My Lib', entityType: 'workflow', version: '0.9.0' },
        { id: 'L888', name: 'Steps', entityType: 'step', version: '0.5.0' },
      ],
      specifications: [
        { id: 'S999', libraryId: 'L999', name: 'Wf A', version: '0.9.0' },
        { id: 'S888', libraryId: 'L888', name: 'St A', version: '0.5.0' },
      ],
    })
    for (const row of plan.rows) {
      expect(row.status.tag).toBe('conflict')
    }
  })

  it('D) same OID — no-op', () => {
    const plan = buildImportPlan(bundle, {
      libraries: [
        { id: 'L100', name: 'My Lib', entityType: 'workflow' },
        { id: 'L200', name: 'Steps', entityType: 'step' },
      ],
      specifications: [
        { id: 'S100', libraryId: 'L100', name: 'Wf A' },
        { id: 'S200', libraryId: 'L200', name: 'St A' },
      ],
    })
    for (const row of plan.rows) {
      expect(row.status.tag).toBe('no-op')
    }
  })
})

describe('buildImportPlan — a team library wins a name match over GLOBAL (spec 2026-10-12 U4)', () => {
  const stepBundle = {
    bundleLibraryName: 'Steps',
    oidIndex: {
      libraries: [{ oid: 'L200', name: 'Steps', entityType: 'step' as const, version: '1.0.0' }],
      specifications: [],
    },
    warnings: [],
  }
  for (const order of ['global-first', 'global-last'] as const) {
    it(`matches the team library (${order})`, () => {
      const g = { id: 'LG', name: 'Steps', entityType: 'step' as const, teamId: 'team-global' }
      const t = { id: 'LT', name: 'Steps', entityType: 'step' as const, teamId: 'team-main' }
      const plan = buildImportPlan(stepBundle, {
        libraries: order === 'global-first' ? [g, t] : [t, g],
        specifications: [],
      })
      expect(plan.rows[0].status).toMatchObject({ tag: 'conflict', existingOid: 'LT' })
    })
  }
})

describe('buildImportPlan — several versions of one name (spec 2026-10-21 §6)', () => {
  it('the conflict is the newest version, compared numerically', () => {
    const plan = buildImportPlan(bundle, {
      libraries: [{ id: 'L999', name: 'My Lib', entityType: 'workflow' }],
      specifications: [
        { id: 'V10', libraryId: 'L999', name: 'Wf A', version: '10.0.0' },
        { id: 'V9', libraryId: 'L999', name: 'Wf A', version: '9.0.0' },
        { id: 'V2', libraryId: 'L999', name: 'Wf A', version: '2.0.0' },
      ],
    })
    const row = plan.rows.find((r) => r.bundleOid === 'S100')!
    expect(row.status).toMatchObject({ tag: 'conflict', existingOid: 'V10', existingVersion: '10.0.0' })
  })
})

describe('buildImportPlan — same OID, changed here since export', () => {
  const lib = { oid: 'L1', name: 'Smoke', entityType: 'workflow' as const, version: '1.0.0' }
  const dbLib = { id: 'L1', name: 'Smoke', entityType: 'workflow' as const, version: '1.0.0' }
  const kd = (oid: string, version: string, state?: string) => ({
    oid,
    libraryOid: 'L1',
    name: 'Kitchen Demo',
    version,
    ...(state ? { state } : {}),
  })
  const here = (id: string, version: string, state: string) => ({
    id,
    libraryId: 'L1',
    name: 'Kitchen Demo',
    version,
    state,
  })

  it('a state change since export is refused, naming the version Effective here', () => {
    const plan = buildImportPlan(
      {
        bundleLibraryName: 'Smoke',
        oidIndex: { libraries: [lib], specifications: [kd('S2', '2.0.0', 'Effective')] },
        warnings: [],
      },
      { libraries: [dbLib], specifications: [here('S2', '2.0.0', 'Obsolete'), here('S3', '3.0.0', 'Effective')] },
    )
    expect(plan.rows.find((r) => r.bundleOid === 'S2')!.status).toEqual({
      tag: 'refused',
      existingOid: 'S2',
      existingName: 'Kitchen Demo',
      existingVersion: '2.0.0',
      existingState: 'Obsolete',
      refusal: { reason: 'changed-since-export', blockers: [], fileState: 'Effective', effectiveVersionHere: '3.0.0' },
    })
  })

  it('a version relabelled in place since export is refused', () => {
    const plan = buildImportPlan(
      {
        bundleLibraryName: 'Smoke',
        oidIndex: { libraries: [lib], specifications: [kd('S2', '1.0.0', 'Draft')] },
        warnings: [],
      },
      { libraries: [dbLib], specifications: [here('S2', '2.0.0', 'Draft')] },
    )
    const s = plan.rows.find((r) => r.bundleOid === 'S2')!.status
    expect(s.tag).toBe('refused')
    if (s.tag === 'refused') {
      expect(s.refusal.reason).toBe('changed-since-export')
      expect(s.refusal.effectiveVersionHere).toBeUndefined()
    }
  })

  it('unchanged state and version stays a no-op', () => {
    const plan = buildImportPlan(
      {
        bundleLibraryName: 'Smoke',
        oidIndex: { libraries: [lib], specifications: [kd('S3', '3.0.0', 'Effective')] },
        warnings: [],
      },
      { libraries: [dbLib], specifications: [here('S3', '3.0.0', 'Effective')] },
    )
    expect(plan.rows.find((r) => r.bundleOid === 'S3')!.status).toEqual({ tag: 'no-op', existingOid: 'S3' })
  })

  it('a file without a state compares the version only', () => {
    const plan = buildImportPlan(
      { bundleLibraryName: 'Smoke', oidIndex: { libraries: [lib], specifications: [kd('S3', '3.0.0')] }, warnings: [] },
      { libraries: [dbLib], specifications: [here('S3', '3.0.0', 'Effective')] },
    )
    expect(plan.rows.find((r) => r.bundleOid === 'S3')!.status.tag).toBe('no-op')
  })
})
