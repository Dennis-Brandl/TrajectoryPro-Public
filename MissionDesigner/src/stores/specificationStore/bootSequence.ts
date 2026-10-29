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

// Phase 35 §4.2: boot sequence (Phase 3 simplified — no IDB crash buffer).
//
// The full §4.2 sequence is:
//   login → /api/me → loadLibraries → IDB recovery check → recovery modal → ready
// The Phase 3 simplification drops the last three steps. Phase 3b cleanup
// adds them back when the crash buffer ships.

import { useSpecificationStore } from '../specificationStore'
import { api, ApiError } from './apiClient'
import { usePrincipalStore } from '../principalStore'

export interface BootResult {
  ok: boolean
  error?: 'me' | 'libraries'
  /** /me answered 401: the operator is not signed in. */
  unauthorized?: boolean
  /** Plain-words cause of a non-401 /me failure. */
  detail?: string
}

export async function runBoot(): Promise<BootResult> {
  const store = useSpecificationStore.getState()
  store.setBootPhase('me-loading')
  try {
    const principal = await api.getMe()
    usePrincipalStore.getState().setPrincipal(principal)
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      // Not logged in — the caller redirects to /login
      return { ok: false, error: 'me', unauthorized: true }
    }
    const detail = err instanceof ApiError ? `Server error ${err.status}` : "Can't reach the server"
    return { ok: false, error: 'me', unauthorized: false, detail }
  }
  store.setBootPhase('libraries-loading')
  try {
    await store.loadLibraries()
  } catch {
    return { ok: false, error: 'libraries' }
  }
  store.setBootPhase('ready')
  return { ok: true }
}
