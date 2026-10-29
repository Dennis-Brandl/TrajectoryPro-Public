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

// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../specificationStore/apiClient', () => ({
  api: {
    importWorkflow: vi.fn(),
    exportWorkflow: vi.fn(),
    getTree: vi.fn(),
    listLibraries: vi.fn(),
    batchSave: vi.fn().mockResolvedValue({ specs: [], libraries: [] }),
  },
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      public body: Record<string, unknown>,
    ) {
      super(`${status}`)
    }
  },
}))

import { api } from '../specificationStore/apiClient'
import { useSpecificationStore } from '../specificationStore'
import { exportWorkflow, importWorkflow, hoverPreviewLoad, hoverPreviewCancel } from '../specificationStore/flows'

beforeEach(() => {
  useSpecificationStore.getState()._reset()
  ;(api.importWorkflow as ReturnType<typeof vi.fn>).mockReset()
  ;(api.exportWorkflow as ReturnType<typeof vi.fn>).mockReset()
  ;(api.getTree as ReturnType<typeof vi.fn>).mockReset()
})

describe('exportWorkflow', () => {
  it('returns the blob, a sanitized filename, and the export warnings', async () => {
    useSpecificationStore.setState((s) => {
      s.specs.set('r', {
        id: 'r',
        parentSpecificationId: null,
        rootSpecificationId: 'r',
        libraryId: 'lib',
        name: 'Root',
        description: null,
        typeName: null,
        version: '1.0.0',
        state: 'Draft',
        data: {},
        dataSchemaVersion: 3,
        history: [],
        createdAt: 0,
        updatedAt: 0,
        lastEditedByUserId: null,
      })
      s.libraries.set('lib', {
        id: 'lib',
        parentLibraryId: null,
        teamId: null,
        name: 'My Lib!',
        entityType: 'workflow',
        description: null,
        author: null,
        changeHistory: null,
        version: '1.0.0',
        environmentLibraryIds: [],
        createdAt: 0,
        updatedAt: 0,
        lastEditedByUserId: null,
      })
    })
    ;(api.exportWorkflow as ReturnType<typeof vi.fn>).mockResolvedValue({
      blob: new Blob(['abc'], { type: 'application/zip' }),
      warnings: ['w1'],
    })
    const result = await exportWorkflow('r')
    expect(result.filename).toBe('Root(1.0.0).WFmasterX')
    expect(result.blob.size).toBe(3)
    expect(result.warnings).toEqual(['w1'])
  })
})

describe('importWorkflow', () => {
  it('calls the api + refreshes the tree', async () => {
    ;(api.importWorkflow as ReturnType<typeof vi.fn>).mockResolvedValue({
      rootSpecId: 'new-r',
      specCount: 1,
      imageCount: 0,
      droppedEnvRefs: [],
    })
    ;(api.listLibraries as ReturnType<typeof vi.fn>).mockResolvedValue({ libraries: [] })
    ;(api.getTree as ReturnType<typeof vi.fn>).mockResolvedValue({
      library: {
        id: 'lib',
        parentLibraryId: null,
        userId: 'u',
        name: 'Lib',
        entityType: 'workflow',
        description: null,
        typeName: null,
        version: '1.0.0',
        forkedFromLibraryId: null,
        forkedFromVersion: null,
        forkedAt: null,
        createdAt: 0,
        updatedAt: 0,
        lastEditedByUserId: null,
      },
      specs: [],
      proxyRefs: [],
      specEnvs: [],
      imageManifest: {},
    })
    const result = await importWorkflow(new File([''], 'x.zip'), 'lib')
    expect(result.rootSpecId).toBe('new-r')
  })

  it('refreshes specStore.libraries from the server so auto-created env / action libraries land in the cache', async () => {
    // Simulate the bug-fix scenario: server auto-creates "Kitchen Library"
    // (env) and "Kitchen Action Library" (action) while ingesting a .WFmasterX
    // whose env spec carries a library_name link. Before the fix, the
    // specStore cache from boot still had only the workflow library, so the
    // sidebar never saw the new entries until a full page reload.
    ;(api.importWorkflow as ReturnType<typeof vi.fn>).mockResolvedValue({
      rootSpecId: 'new-r',
      specCount: 1,
      imageCount: 0,
      droppedEnvRefs: [],
    })
    ;(api.listLibraries as ReturnType<typeof vi.fn>).mockResolvedValue({
      libraries: [
        {
          id: 'lib',
          parentLibraryId: null,
          userId: 'u',
          name: 'Lib',
          entityType: 'workflow',
          description: null,
          typeName: null,
          version: '1.0.0',
          forkedFromLibraryId: null,
          forkedFromVersion: null,
          forkedAt: null,
          createdAt: 0,
          updatedAt: 0,
          lastEditedByUserId: null,
        },
        {
          id: 'envlib',
          parentLibraryId: null,
          userId: 'u',
          name: 'Kitchen Library',
          entityType: 'environment',
          description: null,
          typeName: null,
          version: '1.0.0',
          forkedFromLibraryId: null,
          forkedFromVersion: null,
          forkedAt: null,
          createdAt: 0,
          updatedAt: 0,
          lastEditedByUserId: null,
        },
        {
          id: 'actlib',
          parentLibraryId: null,
          userId: 'u',
          name: 'Kitchen Action Library',
          entityType: 'action',
          description: null,
          typeName: null,
          version: '1.0.0',
          forkedFromLibraryId: null,
          forkedFromVersion: null,
          forkedAt: null,
          createdAt: 0,
          updatedAt: 0,
          lastEditedByUserId: null,
        },
      ],
    })
    ;(api.getTree as ReturnType<typeof vi.fn>).mockResolvedValue({
      library: {
        id: 'lib',
        parentLibraryId: null,
        userId: 'u',
        name: 'Lib',
        entityType: 'workflow',
        description: null,
        typeName: null,
        version: '1.0.0',
        forkedFromLibraryId: null,
        forkedFromVersion: null,
        forkedAt: null,
        createdAt: 0,
        updatedAt: 0,
        lastEditedByUserId: null,
      },
      specs: [],
      proxyRefs: [],
      specEnvs: [],
      imageManifest: {},
    })

    // Pre-seed the spec store with just the workflow library (the cold-boot
    // state before the new env/action libraries existed).
    useSpecificationStore.setState((s) => {
      s.libraries.clear()
      s.libraries.set('lib', {
        id: 'lib',
        parentLibraryId: null,
        teamId: null,
        name: 'Lib',
        entityType: 'workflow',
        description: null,
        author: null,
        changeHistory: null,
        version: '1.0.0',
        environmentLibraryIds: [],
        createdAt: 0,
        updatedAt: 0,
        lastEditedByUserId: null,
      })
      s.isLibrariesLoaded = true
    })
    expect(useSpecificationStore.getState().libraries.size).toBe(1)

    await importWorkflow(new File([''], 'x.zip'), 'lib')

    // After the import, the spec store must reflect the server's full library
    // set — listLibraries was called and its three rows are now cached.
    expect(api.listLibraries).toHaveBeenCalled()
    const libs = useSpecificationStore.getState().libraries
    expect(libs.size).toBe(3)
    expect(libs.get('envlib')?.name).toBe('Kitchen Library')
    expect(libs.get('actlib')?.name).toBe('Kitchen Action Library')
  })
})

describe('hoverPreviewLoad + hoverPreviewCancel', () => {
  it('tracks in-flight loads and allows cancellation', async () => {
    const resolved: { current: ((v: unknown) => void) | null } = { current: null }
    const pending = new Promise((r) => {
      resolved.current = r
    })
    useSpecificationStore.setState((s) => {
      s.inflightPreviewLoads = new Map()
    })
    // Install a fake loadSpec that never resolves until we fire
    const originalLoadSpec = useSpecificationStore.getState().loadSpec
    useSpecificationStore.setState((s) => {
      s.loadSpec = async () => {
        await pending
      }
    })
    const promise = hoverPreviewLoad('p1')
    expect(useSpecificationStore.getState().inflightPreviewLoads.has('p1')).toBe(true)
    expect(useSpecificationStore.getState().currentlyPreviewedId).toBe('p1')
    hoverPreviewCancel('p1')
    resolved.current?.(undefined)
    await promise.catch(() => {})
    expect(useSpecificationStore.getState().inflightPreviewLoads.has('p1')).toBe(false)
    expect(useSpecificationStore.getState().currentlyPreviewedId).toBe(null)
    // Restore
    useSpecificationStore.setState((s) => {
      s.loadSpec = originalLoadSpec
    })
  })
})
