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

import { isGlobalTeam } from '@/lib/global-team'
import type { ImportPlanRow, ImportPlanRowStatus, WflibxEntityType } from '@/types/wflibx-import'
import { compareSemver } from '@/types/version'

export interface ParsedBundle {
  bundleLibraryName: string
  oidIndex: {
    libraries: Array<{ oid: string; name: string; entityType: WflibxEntityType; version: string }>
    /** `state` is read from the spec JSON at preview (the manifest's oidIndex does not carry it). */
    specifications: Array<{ oid: string; libraryOid: string; name: string; version: string; state?: string }>
  }
  warnings: string[]
}

export interface ExistingDbState {
  libraries: Array<{ id: string; name: string; entityType: WflibxEntityType; version?: string; teamId?: string | null }>
  specifications: Array<{ id: string; libraryId: string; name: string; version?: string; state?: string }>
}

export interface PlanResult {
  rows: ImportPlanRow[]
  warnings: string[]
}

export function buildImportPlan(bundle: ParsedBundle, existing: ExistingDbState): PlanResult {
  const rows: ImportPlanRow[] = []

  // Index existing rows for O(1) lookup.
  const libByOid = new Map(existing.libraries.map((l) => [l.id, l]))
  // GLOBAL first, so a team library of the same name overwrites it: the team library wins (spec 2026-10-12 U4).
  const byGlobalFirst = [...existing.libraries].sort(
    (a, b) => Number(!isGlobalTeam(a.teamId)) - Number(!isGlobalTeam(b.teamId)),
  )
  const libByNameType = new Map(byGlobalFirst.map((l) => [`${l.name}::${l.entityType}`, l]))
  const specByOid = new Map(existing.specifications.map((s) => [s.id, s]))
  // Several versions can share a name: the conflict is the newest one (spec 2026-10-21 §6).
  const specByLibAndName = new Map<string, ExistingDbState['specifications'][number]>()
  for (const s of existing.specifications) {
    const key = `${s.libraryId}::${s.name}`
    const held = specByLibAndName.get(key)
    if (!held || compareSemver(s.version ?? '', held.version ?? '') > 0) specByLibAndName.set(key, s)
  }

  // Library rows.
  for (const lib of bundle.oidIndex.libraries) {
    const status = libraryStatus(lib, libByOid, libByNameType)
    rows.push({
      kind: 'library',
      entityType: lib.entityType,
      bundleOid: lib.oid,
      bundleName: lib.name,
      bundleVersion: lib.version,
      status,
    })
  }

  // Spec rows.
  for (const spec of bundle.oidIndex.specifications) {
    const parentLib = bundle.oidIndex.libraries.find((l) => l.oid === spec.libraryOid)
    if (!parentLib) continue
    const status = specStatus(spec, parentLib, libByNameType, specByOid, specByLibAndName, existing.specifications)
    rows.push({
      kind: 'specification',
      entityType: parentLib.entityType,
      bundleOid: spec.oid,
      bundleName: spec.name,
      bundleVersion: spec.version,
      parentLibraryOid: spec.libraryOid,
      status,
    })
  }

  return { rows, warnings: bundle.warnings }
}

function libraryStatus(
  bundleLib: { oid: string; name: string; entityType: WflibxEntityType; version: string },
  libByOid: Map<string, { id: string; name: string; entityType: WflibxEntityType; version?: string }>,
  libByNameType: Map<string, { id: string; name: string; entityType: WflibxEntityType; version?: string }>,
): ImportPlanRowStatus {
  const sameOid = libByOid.get(bundleLib.oid)
  if (sameOid) return { tag: 'no-op', existingOid: sameOid.id }
  const sameNameType = libByNameType.get(`${bundleLib.name}::${bundleLib.entityType}`)
  if (sameNameType) {
    return {
      tag: 'conflict',
      existingOid: sameNameType.id,
      existingName: sameNameType.name,
      existingVersion: sameNameType.version ?? '',
    }
  }
  return { tag: 'create' }
}

function specStatus(
  bundleSpec: { oid: string; libraryOid: string; name: string; version: string; state?: string },
  parentBundleLib: { oid: string; name: string; entityType: WflibxEntityType },
  libByNameType: Map<string, { id: string; name: string; entityType: WflibxEntityType; version?: string }>,
  specByOid: Map<string, ExistingDbState['specifications'][number]>,
  specByLibAndName: Map<string, { id: string; libraryId: string; name: string; version?: string }>,
  existingSpecs: ExistingDbState['specifications'],
): ImportPlanRowStatus {
  const sameOid = specByOid.get(bundleSpec.oid)
  if (sameOid) {
    // Same OID but a different state or version: the file is out of date. Never silently skip it.
    const stateDiffers = bundleSpec.state !== undefined && bundleSpec.state !== (sameOid.state ?? 'Draft')
    const versionDiffers = sameOid.version !== undefined && bundleSpec.version !== sameOid.version
    if (!stateDiffers && !versionDiffers) return { tag: 'no-op', existingOid: sameOid.id }
    const effectiveHere = existingSpecs.find(
      (s) =>
        s.id !== sameOid.id && s.libraryId === sameOid.libraryId && s.name === sameOid.name && s.state === 'Effective',
    )
    return {
      tag: 'refused',
      existingOid: sameOid.id,
      existingName: sameOid.name,
      existingVersion: sameOid.version ?? '',
      existingState: sameOid.state ?? '',
      refusal: {
        reason: 'changed-since-export',
        blockers: [],
        fileState: bundleSpec.state ?? '',
        ...(effectiveHere ? { effectiveVersionHere: effectiveHere.version ?? '' } : {}),
      },
    }
  }
  // Find the existing library this spec would belong to (by name+type lookup on its parent).
  const matchingLib = libByNameType.get(`${parentBundleLib.name}::${parentBundleLib.entityType}`)
  if (!matchingLib) return { tag: 'create' }
  const sameNameSameLib = specByLibAndName.get(`${matchingLib.id}::${bundleSpec.name}`)
  if (sameNameSameLib) {
    return {
      tag: 'conflict',
      existingOid: sameNameSameLib.id,
      existingName: sameNameSameLib.name,
      existingVersion: sameNameSameLib.version ?? '',
    }
  }
  return { tag: 'add-to-existing', existingLibraryOid: matchingLib.id }
}
