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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import JSZip from 'jszip'
import type { Library, Specification, EntityType } from '@/types/library'
import type { LibraryWithChildren } from '../export-types'
import { createLibraryPackage } from '../library-package'
import { importLibraryPackage } from '@/lib/import/library-package'

vi.mock('../../export/download', () => ({
  downloadJSON: vi.fn(),
  downloadBlob: vi.fn(),
  downloadImage: vi.fn(),
  downloadZip: vi.fn(),
}))

// Import AFTER mock registration so the mocked module is used by exportSingleEnvironment.
import { exportSingleEnvironment } from '../../export/single-spec-exporters'
import * as download from '../../export/download'

/**
 * Regression: `X` suffix is reserved for ZIP containers; JSON files inside
 * library packages must use the bare stem (.WFaction, .WFenvir, .WFslib).
 */

function makeLibrary(name: string, entityType: EntityType): Library {
  return {
    id: 'lib-1',
    name,
    entityType,
    createdAt: 0,
    updatedAt: 0,
  }
}

function makeActionSpec(name: string): Specification {
  return {
    id: 'spec-1',
    libraryId: 'lib-1',
    name,
    description: null,
    version: '1.0.0',
    state: 'Draft',
    data: {
      inputParameters: [],
      outputParameters: [],
      valueProperties: [],
    },
    history: [],
    createdAt: 0,
    updatedAt: 0,
  }
}

function makeTree(entityType: EntityType, specs: Specification[]): LibraryWithChildren {
  return { library: makeLibrary(`${entityType} library`, entityType), specifications: specs, children: [] }
}

async function unpack(blob: Blob): Promise<{ names: string[]; manifest: { files: Array<{ path: string }> } }> {
  // jszip's Blob output does not expose `.arrayBuffer()` in jsdom; loadAsync
  // accepts the blob directly.
  const zip = await JSZip.loadAsync(blob as unknown as Blob)
  const names = Object.keys(zip.files)
  const manifestText = await zip.file('manifest.json')!.async('text')
  return { names, manifest: JSON.parse(manifestText) }
}

describe('library package naming convention', () => {
  it('action library writes inner JSON as .WFaction (no X)', async () => {
    const blob = await createLibraryPackage({
      tree: makeTree('action', [makeActionSpec('MyAction')]),
      entityType: 'action',
      images: {},
    })
    const { names, manifest } = await unpack(blob)

    expect(names).toContain('action library.WFaction')
    expect(names).not.toContain('action library.WFactionLibX')
    expect(manifest.files[0].path).toBe('action library.WFaction')
  })

  it('environment library writes inner JSON as .WFenvir (no X)', async () => {
    const blob = await createLibraryPackage({
      tree: makeTree('environment', [
        {
          ...makeActionSpec('MyEnv'),
          data: { included_actions: [], resources: [], actionServers: [] },
        },
      ]),
      entityType: 'environment',
      images: {},
    })
    const { names, manifest } = await unpack(blob)

    expect(names).toContain('environment library.WFenvir')
    expect(names).not.toContain('environment library.WFenvirLibX')
    expect(manifest.files[0].path).toBe('environment library.WFenvir')
  })

  it('step library writes inner JSON as .WFslib (no X)', async () => {
    const blob = await createLibraryPackage({
      tree: makeTree('step', [
        {
          ...makeActionSpec('MyStep'),
          data: { nodes: [], edges: [] },
        },
      ]),
      entityType: 'step',
      images: {},
    })
    const { names, manifest } = await unpack(blob)

    expect(names).toContain('step library.WFslib')
    expect(names).not.toContain('step library.WFstepLibX')
    expect(manifest.files[0].path).toBe('step library.WFslib')
  })
})

describe('exportSingleEnvironment — .WFenvirX single-env package', () => {
  beforeEach(() => {
    vi.mocked(download.downloadBlob).mockClear()
  })

  it('emits a .WFenvirX filename and manifest with packageType environment-package', async () => {
    const envSpec: Specification = {
      id: 'env-spec-1',
      libraryId: 'env-lib-1',
      name: 'Conveyor1',
      description: null,
      version: '1.0.0',
      state: 'Draft',
      data: {
        included_actions: [{ action_library: 'ActionLib', action_name: 'PickAndPlace' }],
        resources: [],
        actionServers: [],
      },
      history: [],
      createdAt: 0,
      updatedAt: 0,
    }
    const envLibrary: Library = {
      id: 'env-lib-1',
      name: 'ConveyorLib',
      entityType: 'environment',
      createdAt: 0,
      updatedAt: 0,
    }
    const actionLib: Library = {
      id: 'action-lib-1',
      name: 'ActionLib',
      entityType: 'action',
      createdAt: 0,
      updatedAt: 0,
    }
    const actionSpec: Specification = {
      id: 'act-spec-1',
      libraryId: 'action-lib-1',
      name: 'PickAndPlace',
      description: null,
      version: '1.0.0',
      state: 'Draft',
      data: {
        inputParameters: [],
        outputParameters: [],
        valueProperties: [],
      },
      history: [],
      createdAt: 0,
      updatedAt: 0,
    }

    const allLibraries = [actionLib]
    const allSpecsByLibrary = new Map([['action-lib-1', [actionSpec]]])

    await exportSingleEnvironment(envSpec, envLibrary, allLibraries, allSpecsByLibrary)

    expect(download.downloadBlob).toHaveBeenCalledOnce()
    const [capturedBlob, capturedFilename] = vi.mocked(download.downloadBlob).mock.calls[0]

    expect(capturedFilename).toBe('Conveyor1(1.0.0).WFenvirX')

    // Inspect the ZIP contents
    const zip = await JSZip.loadAsync(capturedBlob as unknown as Blob)
    const manifestText = await zip.file('manifest.json')!.async('text')
    const manifest = JSON.parse(manifestText)

    expect(manifest.packageType).toBe('environment-package')
    expect(manifest.formatVersion).toBe(2)
    expect(manifest.actionLibraries).toEqual([{ name: 'ActionLib', actions: ['PickAndPlace'] }])
    expect(zip.file('Conveyor1.WFenvir')).not.toBeNull()
    // v2 layout: actions/{ActionLibraryName}/{ActionName}.WFaction
    expect(zip.file('actions/ActionLib/PickAndPlace.WFaction')).not.toBeNull()
  })
})

describe('library package import — inner filename compatibility', () => {
  it('round-trips a newly exported action package', async () => {
    const blob = await createLibraryPackage({
      tree: makeTree('action', [makeActionSpec('MyAction')]),
      entityType: 'action',
      images: {},
    })
    const file = new File([blob], 'x.WFactionLibX')
    const result = await importLibraryPackage(file)
    expect('error' in result).toBe(false)
    if ('error' in result) return
    if ('packageType' in result) throw new Error('unexpected env-package routing')
    expect(result.entityType).toBe('action')
    expect(result.libraryName).toBe('action library')
  })

  it('still accepts legacy packages whose inner file keeps the X suffix', async () => {
    // Simulate a package produced by the pre-fix exporter.
    const zip = new JSZip()
    zip.file('Legacy.WFactionX', JSON.stringify({ local_id: 'Legacy', action_specifications: [] }))
    zip.file(
      'manifest.json',
      JSON.stringify({
        packageType: 'action-library',
        packageVersion: '1.0',
        libraryName: 'Legacy',
        createdAt: new Date().toISOString(),
        files: [{ path: 'Legacy.WFactionX', type: 'action-library' }],
      }),
    )
    const blob = await zip.generateAsync({ type: 'blob' })
    const file = new File([blob], 'Legacy.WFactionX')
    const result = await importLibraryPackage(file)
    expect('error' in result).toBe(false)
    if ('error' in result) return
    if ('packageType' in result) throw new Error('unexpected env-package routing')
    expect(result.entityType).toBe('action')
    expect(result.libraryName).toBe('Legacy')
  })

  it('still accepts legacy environment packages with X-suffixed inner', async () => {
    const zip = new JSZip()
    zip.file('Legacy.WFenvirX', JSON.stringify({ local_id: 'Legacy', environment_specifications: [] }))
    const blob = await zip.generateAsync({ type: 'blob' })
    const file = new File([blob], 'Legacy.WFenvirX')
    const result = await importLibraryPackage(file)
    expect('error' in result).toBe(false)
    if ('error' in result) return
    if ('packageType' in result) throw new Error('unexpected env-package routing')
    expect(result.entityType).toBe('environment')
  })
})
