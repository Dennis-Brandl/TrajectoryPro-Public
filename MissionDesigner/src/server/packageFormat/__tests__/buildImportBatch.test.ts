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

// @vitest-environment node

import { describe, it, expect } from 'vitest'
import { buildImportBatch } from '../buildImportBatch'
import type { ImportPlan } from '../parseEnvelope'

const onePlan: ImportPlan = {
  specs: [
    {
      sourceId: 'src-r1',
      parentSourceId: null,
      rootSourceId: 'src-r1',
      name: 'Root',
      description: null,
      version: '1.0.0',
      state: 'Draft',
      dataJson: '{"nodes":[]}',
      dataSchemaVersion: 3,
    },
  ],
  proxyRefs: [],
  imageRefs: [],
  specEnvs: [],
  pendingEnvLibraryLinks: [],
}

describe('buildImportBatch', () => {
  it('returns a BatchSaveRequest with one create and a fresh id', () => {
    const result = buildImportBatch(onePlan, 'lib1')
    expect(result.batch.specs).toHaveLength(1)
    expect(result.batch.specs[0]).toMatchObject({
      op: 'create',
      libraryId: 'lib1',
      name: 'Root',
      data: '{"nodes":[]}',
      dataSchemaVersion: 3,
      version: '1.0.0',
      state: 'Draft',
    })
    expect((result.batch.specs[0] as { id: string }).id).not.toBe('src-r1')
    expect(result.idMap.get('src-r1')).toBe((result.batch.specs[0] as { id: string }).id)
  })

  it('remaps a parent/child pair so the child references the new parent id', () => {
    const plan: ImportPlan = {
      specs: [
        { ...onePlan.specs[0] },
        {
          sourceId: 'src-c1',
          parentSourceId: 'src-r1',
          rootSourceId: 'src-r1',
          name: 'Child',
          description: null,
          version: '1.0.0',
          state: 'Draft',
          dataJson: '{"nodes":[]}',
          dataSchemaVersion: 3,
        },
      ],
      proxyRefs: [],
      imageRefs: [],
      specEnvs: [],
      pendingEnvLibraryLinks: [],
    }
    const result = buildImportBatch(plan, 'lib1')
    const childCreate = result.batch.specs.find((s) => (s as { name: string }).name === 'Child') as {
      parentSpecificationId: string
      rootSpecificationId: string
    }
    const newRootId = result.idMap.get('src-r1')!
    expect(childCreate.parentSpecificationId).toBe(newRootId)
    expect(childCreate.rootSpecificationId).toBe(newRootId)
  })

  it('emits proxyRef creates with remapped parent + target ids', () => {
    const plan: ImportPlan = {
      specs: [
        { ...onePlan.specs[0] },
        {
          sourceId: 'src-target',
          parentSourceId: null,
          rootSourceId: 'src-target',
          name: 'Target',
          description: null,
          version: '1.0.0',
          state: 'Draft',
          dataJson: '{"nodes":[]}',
          dataSchemaVersion: 3,
        },
      ],
      proxyRefs: [{ parentSourceId: 'src-r1', nodeId: 'n1', targetSourceId: 'src-target' }],
      imageRefs: [],
      specEnvs: [],
      pendingEnvLibraryLinks: [],
    }
    const result = buildImportBatch(plan, 'lib1')
    expect(result.batch.proxyRefs).toHaveLength(1)
    const proxy = result.batch.proxyRefs[0] as {
      op: string
      parentSpecificationId: string
      targetSpecificationId: string
      nodeId: string
    }
    expect(proxy.op).toBe('create')
    expect(proxy.parentSpecificationId).toBe(result.idMap.get('src-r1'))
    expect(proxy.targetSpecificationId).toBe(result.idMap.get('src-target'))
    expect(proxy.nodeId).toBe('n1')
  })

  it('imageRefs and imageDeletes are always empty (image rows go through a separate step)', () => {
    const result = buildImportBatch(onePlan, 'lib1')
    expect(result.batch.imageRefs).toEqual([])
    expect(result.batch.imageDeletes).toEqual([])
  })

  it('remaps specEnvs onto the new root spec id and passes env library ids through verbatim', () => {
    const plan: ImportPlan = {
      ...onePlan,
      specEnvs: [{ specSourceId: 'src-r1', environmentLibraryId: 'env-lib-1' }],
    }
    const result = buildImportBatch(plan, 'lib1')
    expect(result.batch.specEnvs).toHaveLength(1)
    const env = result.batch.specEnvs[0] as {
      op: string
      specificationId: string
      environmentLibraryId: string
    }
    expect(env.op).toBe('create')
    expect(env.specificationId).toBe(result.idMap.get('src-r1'))
    expect(env.environmentLibraryId).toBe('env-lib-1')
  })

  it('drops specEnvs whose sourceId is not in the import plan (defensive)', () => {
    const plan: ImportPlan = {
      ...onePlan,
      specEnvs: [{ specSourceId: 'src-missing', environmentLibraryId: 'env-lib-1' }],
    }
    const result = buildImportBatch(plan, 'lib1')
    expect(result.batch.specEnvs).toEqual([])
  })

  it('returns the imageRef plan (newSpecId + filename + sourceSpecId) so the post-batch step can wire image rows', () => {
    const plan: ImportPlan = {
      ...onePlan,
      imageRefs: [{ specSourceId: 'src-r1', filename: 'a.png' }],
    }
    const result = buildImportBatch(plan, 'lib1')
    expect(result.imageInserts).toEqual([
      { newSpecId: result.idMap.get('src-r1'), filename: 'a.png', sourceSpecId: 'src-r1' },
    ])
  })

  it('dedupes imageInserts when the same (specSourceId, filename) appears in multiple form layouts', () => {
    // Parsers emit one imageRef per device layout (phone/tablet/desktop), so an
    // image element shared across layouts produces three identical refs.
    // Without dedup, insertImportImages tries to create three image rows with
    // the same (specificationId, filename) and trips the UNIQUE constraint
    // (`UNIQUE constraint failed: image.specificationId, image.filename`).
    const plan: ImportPlan = {
      ...onePlan,
      imageRefs: [
        { specSourceId: 'src-r1', filename: 'cover.png' },
        { specSourceId: 'src-r1', filename: 'cover.png' },
        { specSourceId: 'src-r1', filename: 'cover.png' },
        { specSourceId: 'src-r1', filename: 'banner.png' },
      ],
    }
    const result = buildImportBatch(plan, 'lib1')
    expect(result.imageInserts).toHaveLength(2)
    expect(result.imageInserts.map((i) => i.filename).sort()).toEqual(['banner.png', 'cover.png'])
    expect(new Set(result.imageInserts.map((i) => i.newSpecId)).size).toBe(1)
  })

  it('auto-renames a duplicate-named sibling so children do not collide on (parent,name,version)', () => {
    // A package can carry two children that share (name, version) under the same
    // parent (allowed by older editor schemas). They remap to the same new parent
    // id, so the second INSERT would trip specification_sibling_name_unique and
    // 409 the whole import. buildImportBatch must disambiguate the later name.
    const dupChild = (sourceId: string) => ({
      sourceId,
      parentSourceId: 'src-r1',
      rootSourceId: 'src-r1',
      name: 'Dup Child',
      description: null,
      version: '1.0.0',
      state: 'Draft',
      dataJson: '{"nodes":[]}',
      dataSchemaVersion: 3,
    })
    const plan: ImportPlan = {
      specs: [{ ...onePlan.specs[0] }, dupChild('src-c1'), dupChild('src-c2')],
      proxyRefs: [],
      imageRefs: [],
      specEnvs: [],
      pendingEnvLibraryLinks: [],
    }
    const result = buildImportBatch(plan, 'lib1')
    const newRootId = result.idMap.get('src-r1')!
    const childNames = (
      result.batch.specs.filter(
        (s) => (s as { parentSpecificationId: string | null }).parentSpecificationId === newRootId,
      ) as Array<{ name: string }>
    )
      .map((c) => c.name)
      .sort()
    expect(childNames).toEqual(['Dup Child', 'Dup Child (2)'])
  })

  it('auto-renames a root whose (name,version) already exists in the target library', () => {
    // Re-importing a workflow that already exists collides on
    // specification_root_name_unique. Given the existing root key, the imported
    // root is renamed rather than failing with a 409.
    const result = buildImportBatch(onePlan, 'lib1', [{ name: 'Root', version: '1.0.0' }])
    expect((result.batch.specs[0] as { name: string }).name).toBe('Root (2)')
  })
})

describe('buildImportBatch — typeName', () => {
  it('carries the plan typeName into the create, and null when absent', () => {
    const plan: ImportPlan = {
      ...onePlan,
      specs: [
        { ...onePlan.specs[0], typeName: 'Procedure' },
        { ...onePlan.specs[0], sourceId: 'src-c1', parentSourceId: 'src-r1', name: 'Child' },
      ],
    }
    const { batch } = buildImportBatch(plan, 'lib1')
    expect(batch.specs[0]).toMatchObject({ typeName: 'Procedure' })
    expect(batch.specs[1]).toMatchObject({ typeName: null })
  })
})
