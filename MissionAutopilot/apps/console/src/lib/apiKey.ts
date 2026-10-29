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

const STORAGE_KEY = 'mission-autopilot.api-key'

export const UNAUTHORIZED_EVENT = 'autopilot:unauthorized'

export function getApiKey(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function setApiKey(key: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, key)
  } catch {
    /* storage unavailable: nothing to remember */
  }
}

export function clearApiKey(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* nothing to clear */
  }
}

/** fetch() that adds the stored API key; a 401 clears the key and signals the app to sign in again. */
export async function authedFetch(input: string, init?: RequestInit): Promise<Response> {
  const key = getApiKey()
  const headers = new Headers(init?.headers)
  if (key) headers.set('X-API-Key', key)
  const res = await fetch(input, { ...init, headers })
  if (res.status === 401) {
    clearApiKey()
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
  }
  return res
}
