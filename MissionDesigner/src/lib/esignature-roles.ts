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

// Spec 2026-09-06 §4.2: the read-only, any-session view of the E-Signature Roles list, for
// the form-designer inspector. Administration edits it through adminClient.

import { useEffect, useState } from 'react'

export async function fetchESignatureRoles(): Promise<string[]> {
  const res = await fetch('/api/v2/esignature-roles', { credentials: 'include' })
  if (!res.ok) throw new Error(`Failed to load e-signature roles (${res.status})`)
  return ((await res.json()) as { roles: string[] }).roles
}

export interface ESignatureRolesState {
  roles: string[]
  loading: boolean
  error: string | null
}

/** Hand-rolled load-once hook (the repo uses no fetching library). */
export function useESignatureRoles(): ESignatureRolesState {
  const [state, setState] = useState<ESignatureRolesState>({ roles: [], loading: true, error: null })
  useEffect(() => {
    let alive = true
    fetchESignatureRoles()
      .then((roles) => alive && setState({ roles, loading: false, error: null }))
      .catch(
        (err: unknown) =>
          alive &&
          setState({
            roles: [],
            loading: false,
            error: err instanceof Error ? err.message : 'Failed to load e-signature roles',
          }),
      )
    return () => {
      alive = false
    }
  }, [])
  return state
}
