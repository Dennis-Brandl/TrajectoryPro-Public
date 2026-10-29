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

import type { ReleasedSpecSummary } from '@/types/library'
import { EXPORT_WARNINGS_HEADER, decodeExportWarnings } from '@/lib/packageFormat/export-warnings-header'

// Phase 35 §3.5 + §4: thin fetch wrappers for every /api/v2/* endpoint the
// specificationStore needs. Every call sets credentials: 'include' for the
// better-auth session cookie. Non-2xx responses throw ApiError with the
// body code attached so the caller can branch on it without reading the body.

/** Shape of GET /api/v2/me. */
export interface MePrincipal {
  userId: string
  isAdministrator: boolean
  memberships: string[]
  rightsByTeam: Record<string, string[]>
  teams: Array<{ id: string; name: string; isGlobal?: boolean }>
  /** Live edit-locked lifecycle states (design §6) — drives client canvas read-only. Optional: absent on minimal fixtures; consumers default to the seeded set. */
  editLockedStates?: string[]
  /** Display name from /me (Phase 5d slice 2). Optional/nullable: absent on minimal test fixtures. */
  name?: string | null
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public body: Record<string, unknown>,
  ) {
    super(`${status} ${code}`)
    this.name = 'ApiError'
  }
}

async function handle(res: Response): Promise<Record<string, unknown>> {
  let body: Record<string, unknown>
  try {
    body = (await res.json()) as Record<string, unknown>
  } catch {
    if (res.ok) return {}
    throw new ApiError(res.status, 'unknown', {})
  }
  if (!res.ok) {
    const code = typeof body.code === 'string' ? body.code : 'unknown'
    throw new ApiError(res.status, code, body)
  }
  return body
}

async function get(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(path, { credentials: 'include' })
  return handle(res)
}

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handle(res)
}

async function patch(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(path, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handle(res)
}

async function del(path: string, body?: unknown): Promise<void> {
  const res = await fetch(
    path,
    body === undefined
      ? { method: 'DELETE', credentials: 'include' }
      : {
          method: 'DELETE',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  )
  if (!res.ok) {
    let body: Record<string, unknown> = {}
    try {
      body = (await res.json()) as Record<string, unknown>
    } catch {
      /* empty */
    }
    throw new ApiError(res.status, typeof body.code === 'string' ? body.code : 'unknown', body)
  }
}

export const api = {
  // §2.11
  async getMe() {
    // Through `unknown`: MePrincipal is an interface, so unlike this file's anonymous
    // response types it gets no implicit index signature and cannot cast directly from
    // get()'s Record<string, unknown>.
    return (await get('/api/v2/me')) as unknown as MePrincipal
  },
  // §2.9
  async listLibraries(entityType?: string) {
    const q = entityType ? `?entityType=${encodeURIComponent(entityType)}` : ''
    return (await get(`/api/v2/libraries${q}`)) as { libraries: Array<Record<string, unknown>> }
  },
  async listLibrarySpecs(libraryId: string) {
    return (await get(`/api/v2/libraries/${libraryId}/specifications`)) as {
      library: { id: string }
      specs: Array<Record<string, unknown>>
    }
  },
  async getLibraryTree(libraryId: string) {
    return (await get(`/api/v2/libraries/${libraryId}/specifications/tree`)) as {
      roots: Array<{
        id: string
        libraryId: string | null
        name: string
        description: string | null
        typeName?: string | null
        version: string | null
        state: string | null
        createdAt: number
        updatedAt: number
        lastEditedByUserId: string | null
        children: unknown[]
        referencedChildren: Array<{ specId: string; specName: string; libraryId: string; libraryName: string }>
      }>
    }
  },
  // §2.5
  async getTree(rootSpecId: string) {
    return (await get(`/api/v2/specifications/${rootSpecId}/tree`)) as {
      library: Record<string, unknown>
      specs: Array<Record<string, unknown>>
      proxyRefs: Array<{ parentSpecificationId: string; nodeId: string; targetSpecificationId: string }>
      specEnvs: Array<{ specificationId: string; environmentLibraryId: string }>
      imageManifest: Record<string, Array<{ filename: string; mimeType: string; byteSize: number }>>
    }
  },
  // §2.3
  async getSpec(id: string) {
    return (await get(`/api/v2/specifications/${id}`)) as { spec: Record<string, unknown> }
  },
  // §2.7
  async bulkFetch(specIds: string[]) {
    return (await post('/api/v2/specifications/bulk-fetch', { specIds })) as {
      specs: Array<Record<string, unknown>>
      missingIds: string[]
    }
  },
  // §2.4
  async batchSave(payload: unknown) {
    return (await post('/api/v2/specifications/batch-save', payload)) as {
      specs: Array<{ id: string }>
      libraries: Array<{ id: string }>
    }
  },
  // §2.10
  async exportWorkflow(rootSpecId: string): Promise<{ blob: Blob; warnings: string[] }> {
    const res = await fetch(`/api/v2/packages/workflow/${rootSpecId}`, { credentials: 'include' })
    if (!res.ok) {
      let body: Record<string, unknown> = {}
      try {
        body = (await res.json()) as Record<string, unknown>
      } catch {
        /* ignore */
      }
      throw new ApiError(res.status, typeof body.code === 'string' ? body.code : 'unknown', body)
    }
    // GATE follow-up item 5: the builder's warnings ride back in one header beside the ZIP body.
    return { blob: await res.blob(), warnings: decodeExportWarnings(res.headers.get(EXPORT_WARNINGS_HEADER)) }
  },
  async importWorkflow(file: File, targetLibraryId: string) {
    const form = new FormData()
    form.set('file', file)
    form.set('targetLibraryId', targetLibraryId)
    const res = await fetch('/api/v2/packages/import', { method: 'POST', credentials: 'include', body: form })
    return handle(res) as Promise<{
      rootSpecId: string
      specCount: number
      imageCount: number
      droppedEnvRefs: unknown[]
    }>
  },
  async previewWorkflowLibraryImport(file: File): Promise<import('@/types/wflibx-import').ImportPlan> {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch('/api/v2/packages/workflow-library/preview', {
      method: 'POST',
      credentials: 'include',
      body: form,
    })
    return (await handle(res)) as unknown as import('@/types/wflibx-import').ImportPlan
  },
  async commitWorkflowLibraryImport(
    req: import('@/types/wflibx-import').CommitRequest,
  ): Promise<import('@/types/wflibx-import').PostImportReport> {
    return (await post(
      '/api/v2/packages/workflow-library/commit',
      req,
    )) as unknown as import('@/types/wflibx-import').PostImportReport
  },
  // §2.6
  async uploadImage(specId: string, file: File, filename: string) {
    const form = new FormData()
    form.set('filename', filename)
    form.set('file', file, filename)
    const res = await fetch(`/api/v2/specifications/${specId}/images`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    })
    return handle(res) as Promise<{
      id: string
      filename: string
      mimeType: string
      byteSize: number
      contentHash: string
    }>
  },
  async refBulkImages(specId: string, items: Array<{ contentHash: string; filename: string }>) {
    return (await post(`/api/v2/specifications/${specId}/images/ref-bulk`, { items })) as {
      items: Array<{ id: string; filename: string; mimeType: string; contentHash: string }>
    }
  },
  getImageUrl(specId: string, filename: string): string {
    return `/api/v2/specifications/${specId}/images/${encodeURIComponent(filename)}`
  },
  async createLibrary(input: {
    name: string
    entityType: string
    teamId?: string
    parentLibraryId?: string
    description?: string
  }) {
    return (await post('/api/v2/libraries', input)) as { library: Record<string, unknown> }
  },

  async updateLibrary(
    id: string,
    body: {
      name?: string
      description?: string | null
      author?: string | null
      changeHistory?: string | null
      version?: string
      environmentLibraryIds?: string[] | null
    },
  ) {
    return (await patch(`/api/v2/libraries/${id}`, body)) as { library: Record<string, unknown> }
  },

  async deleteLibrary(id: string, confirmedReleasedIds?: string[]) {
    return del(`/api/v2/libraries/${id}`, confirmedReleasedIds === undefined ? undefined : { confirmedReleasedIds })
  },
  async getLibraryDeleteCheck(id: string): Promise<{ releasedSpecs: ReleasedSpecSummary[] }> {
    const res = await fetch(`/api/v2/libraries/${id}/delete-check`, { credentials: 'include' })
    return (await handle(res)) as unknown as { releasedSpecs: ReleasedSpecSummary[] }
  },
}
