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
import { renderHook, act } from '@testing-library/react'
import { toast } from 'sonner'
import { useLibraryExport } from '../use-library-export'
import { useLibraryStore } from '@/stores/libraryStore'
import { useSpecificationStore } from '@/stores/specificationStore'
import JSZip from 'jszip'
import { encodeExportWarnings } from '@/lib/packageFormat/export-warnings-header'

vi.mock('@/stores/specificationStore/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/stores/specificationStore/apiClient')>()
  return {
    ...actual,
    api: { ...actual.api, listLibrarySpecs: vi.fn(async () => ({ specs: [{ id: 'spec-1' }, { id: 'spec-2' }] })) },
  }
})

vi.mock('sonner', () => ({
  toast: { loading: vi.fn(() => 'toast-1'), success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

const mockFetch = vi.fn()
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04])

function zipResponse(warnings: string[]): Response {
  const headers: Record<string, string> = { 'content-type': 'application/zip' }
  const encoded = encodeExportWarnings(warnings)
  if (encoded) headers['x-export-warnings'] = encoded
  return new Response(ZIP, { status: 200, headers })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockReset()
  global.fetch = mockFetch as unknown as typeof fetch
  // jsdom implements neither object URLs nor navigation; the download itself is not under test.
  URL.createObjectURL = vi.fn(() => 'blob:mock')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

  useLibraryStore.setState({
    libraries: [{ id: 'lib-wf', name: 'Flows', entityType: 'workflow', createdAt: 0, updatedAt: 0 }],
    selectedLibraryId: 'lib-wf',
  })
  useSpecificationStore.setState({
    specs: new Map([
      [
        'spec-1',
        {
          id: 'spec-1',
          parentSpecificationId: null,
          rootSpecificationId: 'spec-1',
          libraryId: 'lib-wf',
          name: 'Flow',
          description: null,
          typeName: null,
          version: '1.0.0',
          state: 'Draft',
          data: {},
          dataSchemaVersion: 5,
          history: [],
          createdAt: 0,
          updatedAt: 0,
          lastEditedByUserId: null,
        },
      ],
    ]),
  })
})

describe('useLibraryExport.handleExportSpecPDF — workflow round-trip export (GATE follow-up item 5)', () => {
  it('toasts the warnings the server returned in x-export-warnings after the download toast', async () => {
    const warnings = [
      'Gate "Gate" input "Trigger": property "Sensor" is declared by 2 environments — bound to "Alpha" (first in spec order)',
      'Image "bad.png" not exported: spec.data.images value is not a base64 data URI',
    ]
    mockFetch.mockResolvedValue(zipResponse(warnings))

    const { result } = renderHook(() => useLibraryExport())
    await act(async () => {
      await result.current.handleExportSpecPDF('spec-1', 'lib-wf')
    })

    expect(mockFetch).toHaveBeenCalledWith('/api/v2/packages/workflow/spec-1', expect.anything())
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining('Downloaded Flow(1.0.0).WFmasterX'),
      expect.anything(),
    )
    expect(toast.warning).toHaveBeenCalledTimes(1)
    const [message, opts] = vi.mocked(toast.warning).mock.calls[0]
    expect(message).toContain(warnings[0])
    expect(message).toContain(warnings[1])
    expect(opts).toMatchObject({ duration: 10_000 })
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('shows no warning toast when the export was clean', async () => {
    mockFetch.mockResolvedValue(zipResponse([]))

    const { result } = renderHook(() => useLibraryExport())
    await act(async () => {
      await result.current.handleExportSpecPDF('spec-1', 'lib-wf')
    })

    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(toast.warning).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe('useLibraryExport.handleExportLibrary — workflow type_name (ISA 88)', () => {
  it('keeps the root and child workflow type_name in the .WFlibX', async () => {
    const base = {
      libraryId: 'lib-wf',
      description: null,
      version: '1.0.0',
      state: 'Draft' as const,
      dataSchemaVersion: 5,
      history: [],
      createdAt: 0,
      updatedAt: 0,
      lastEditedByUserId: null,
    }
    useSpecificationStore.setState({
      specs: new Map([
        [
          'spec-1',
          {
            ...base,
            id: 'spec-1',
            parentSpecificationId: null,
            rootSpecificationId: 'spec-1',
            name: 'Flow',
            typeName: 'Procedure',
            data: {},
          },
        ],
        [
          'spec-2',
          {
            ...base,
            id: 'spec-2',
            parentSpecificationId: 'spec-1',
            rootSpecificationId: 'spec-1',
            name: 'Sub',
            typeName: 'Phase',
            data: { parentSpecificationId: 'spec-1' },
          },
        ],
      ]),
    })
    let captured: Blob | null = null
    URL.createObjectURL = vi.fn((b: Blob | MediaSource) => {
      captured = b as Blob
      return 'blob:mock'
    })

    const { result } = renderHook(() => useLibraryExport())
    await act(async () => {
      await result.current.handleExportLibrary()
    })

    expect(toast.error).not.toHaveBeenCalled()
    const zip = await JSZip.loadAsync(captured as unknown as Blob)
    const inner = zip.file(/\.WFlib$/)[0]
    const json = JSON.parse(await inner.async('string'))
    const root = json.workflow_specifications[0]
    expect(root.type_name).toBe('Procedure')
    expect(JSON.stringify(root.children)).toContain('"type_name":"Phase"')
  })
})
