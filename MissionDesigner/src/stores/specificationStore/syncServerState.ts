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

import { useSpecificationStore } from '../specificationStore'
import { api } from './apiClient'
import { parseHistory } from '@/types/specification-history'

/**
 * Bring cached specs' state, version and history up to date with a server listing
 * (GET /libraries/:id/specifications rows). The browser copy goes stale whenever the
 * state changes elsewhere: another tab or user, or the server's own supersede sweep.
 * Content is never touched, so unsaved edits survive. Only specs that differ are re-fetched.
 */
export async function syncServerState(listed: Array<Record<string, unknown>>): Promise<void> {
  const cached = useSpecificationStore.getState().specs
  const stale = listed
    .filter((row) => {
      const spec = typeof row.id === 'string' ? cached.get(row.id) : undefined
      if (!spec) return false
      // Compare only what the listing carries.
      return (
        (typeof row.state === 'string' && row.state !== spec.state) ||
        (typeof row.version === 'string' && row.version !== spec.version)
      )
    })
    .map((row) => row.id as string)
  if (stale.length === 0) return
  const { specs } = await api.bulkFetch(stale)
  const store = useSpecificationStore.getState()
  for (const raw of specs) {
    if (typeof raw.id !== 'string' || typeof raw.state !== 'string') continue
    store.applyServerState(raw.id, {
      state: raw.state,
      history: parseHistory(raw.history as string | undefined),
      ...(typeof raw.version === 'string' ? { version: raw.version } : {}),
    })
  }
}
