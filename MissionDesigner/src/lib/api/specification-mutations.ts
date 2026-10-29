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

import type { Specification, SpecificationState } from '@/types/library'
import { ApiError } from '@/stores/specificationStore/apiClient'

async function send<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  if (!res.ok) {
    let body: Record<string, unknown> = {}
    try {
      body = (await res.json()) as Record<string, unknown>
    } catch {
      // non-JSON error body (proxy page etc.) — keep an 'unknown' code
    }
    throw new ApiError(res.status, typeof body.code === 'string' ? body.code : 'unknown', body)
  }
  return (await res.json()) as T
}

export async function changeSpecificationState(
  specId: string,
  newState: SpecificationState,
  reason: string,
  effectiveFrom?: number,
): Promise<Specification> {
  const body = await send<{ spec: Specification }>(`/api/v2/specifications/${specId}/state`, {
    method: 'PATCH',
    body: JSON.stringify({ newState, reason, ...(effectiveFrom !== undefined ? { effectiveFrom } : {}) }),
  })
  return body.spec
}

export async function createNewSpecificationVersion(specId: string, version: string): Promise<Specification> {
  const body = await send<{ newSpec: Specification }>(`/api/v2/specifications/${specId}/new-version`, {
    method: 'POST',
    body: JSON.stringify({ version }),
  })
  return body.newSpec
}

/**
 * In-place version bump (VersionBadge dialog). Must go through this dedicated
 * route: batch-save deliberately ignores `version` on update, so a bump written
 * only via updateInMemory never reaches the row — exports then carry the old
 * version (2026-08-11 user-testing bug).
 */
export async function updateSpecificationVersion(specId: string, version: string): Promise<Specification> {
  const body = await send<{ spec: Specification }>(`/api/v2/specifications/${specId}/version`, {
    method: 'PATCH',
    body: JSON.stringify({ version }),
  })
  return body.spec
}

/** Failure copy for the bump dialog's toast, shared by every VersionBadge host. */
export function bumpErrorMessage(err: unknown, version: string): string {
  const code = err instanceof ApiError ? err.code : null
  if (code === 'conflict') return `Version ${version} already exists for this name`
  if (code === 'edit_locked') return 'This specification is locked — use Create New Version instead'
  return err instanceof Error && err.message ? err.message : 'Failed to update version'
}
