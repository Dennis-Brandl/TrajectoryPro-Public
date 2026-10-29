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

import { describe, it, expect, vi } from 'vitest'
import JSZip from 'jszip'

vi.mock('../../dao/specReadDao', () => ({
  specReadDao: {
    getTree: vi.fn(() => null),
    getSpecs: vi.fn(() => ({ specs: new Map(), missingIds: [] })),
    getLibrary: vi.fn(() => null),
    listVisibleLibraries: vi.fn(() => []),
    listRootSpecs: vi.fn(() => []),
  },
}))
vi.mock('../loadImageBytes', () => ({ loadImageBytesForSpecs: vi.fn(async () => new Map()) }))

import { buildWorkflowPackage } from '../buildWorkflowPackage'
import type { SpecTree } from '../../dao/specReadDao'

function row(id: string, parent: string | null, name: string, typeName: string | null) {
  return {
    id,
    libraryId: 'lib-1',
    name,
    description: null,
    typeName,
    version: '1.0.0',
    state: 'Draft',
    createdAt: 1,
    updatedAt: 1,
    lastEditedByUserId: null,
    data: JSON.stringify({ nodes: [], edges: [] }),
    dataSchemaVersion: 4,
    parentSpecificationId: parent,
    rootSpecificationId: 'root',
    effectiveFrom: null,
    history: [],
  }
}

async function build(rootType: string | null, childType: string | null): Promise<Record<string, unknown>> {
  const tree = {
    library: {
      id: 'lib-1',
      parentLibraryId: null,
      name: 'Lib',
      entityType: 'workflow',
      description: null,
      author: null,
      changeHistory: null,
      version: '1.0.0',
      environmentLibraryIds: null,
      createdAt: 1,
      updatedAt: 1,
      lastEditedByUserId: null,
      teamId: null,
      createdByUserId: null,
    },
    specs: [row('root', null, 'Root', rootType), row('kid', 'root', 'Kid', childType)],
    proxyRefs: [],
    specEnvs: [],
    imageManifest: {},
  } as unknown as SpecTree
  const res = await buildWorkflowPackage({ tree, ctx: { sessionUserId: 'u' }, workflowName: 'Root' })
  const zip = await JSZip.loadAsync(res.zipBytes)
  const entry = Object.keys(zip.files).find((n) => n.endsWith('.WFmaster'))!
  return JSON.parse(await zip.files[entry].async('string')) as Record<string, unknown>
}

describe('buildWorkflowPackage — type_name', () => {
  it('writes type_name on the root and nested child of the .WFmaster', async () => {
    const json = await build('Procedure', 'Unit Procedure')
    expect(json.type_name).toBe('Procedure')
    const kids = json.children as Array<Record<string, unknown>>
    expect(kids[0].type_name).toBe('Unit Procedure')
  })

  it('omits type_name when unset', async () => {
    const json = await build(null, null)
    expect('type_name' in json).toBe(false)
    expect('type_name' in (json.children as Array<Record<string, unknown>>)[0]).toBe(false)
  })
})
