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

const MIN_API_KEY_LENGTH = 32

/** Trimmed ACTIONS_API_KEY, or null when missing or shorter than 32 characters. */
export function readApiKey(env: NodeJS.ProcessEnv): string | null {
  const key = (env.ACTIONS_API_KEY ?? '').trim()
  return key.length >= MIN_API_KEY_LENGTH ? key : null
}

/** Host names the server answers to (everything else is refused with 403). */
export function allowedHosts(env: NodeJS.ProcessEnv): Set<string> {
  const hosts = new Set(['localhost', '127.0.0.1', '::1', 'mission-autopilot-server'])
  if (env.FLEET_BASE_URL) {
    try {
      hosts.add(new URL(env.FLEET_BASE_URL).hostname.toLowerCase())
    } catch {
      // unparsable FLEET_BASE_URL — ignore
    }
  }
  for (const h of (env.ACTIONS_ALLOWED_HOSTS ?? '').split(',')) {
    const t = h.trim().toLowerCase()
    if (t) hosts.add(t)
  }
  return hosts
}

/**
 * CORS origin policy. Returns true when the request Origin is allowed:
 *  - no Origin (same-origin / non-browser clients) → allowed
 *  - loopback origins (localhost / 127.0.0.1 / ::1, any port) → always allowed,
 *    so the bundled console (http://localhost:3003) and local tooling keep working
 *    even when an allowlist is configured
 *  - ACTIONS_ALLOWED_ORIGINS (comma-separated) → adds those origins
 *  - anything else → refused, which blocks drive-by requests from internet sites.
 */
export function isOriginAllowed(
  origin: string | undefined,
  allowedEnv: string | undefined
): boolean {
  if (!origin) return true
  const allowlist = (allowedEnv ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (allowlist.includes(origin)) return true
  try {
    const hostname = new URL(origin).hostname
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '[::1]'
    )
  } catch {
    return false
  }
}
