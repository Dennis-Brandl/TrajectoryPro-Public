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

/** Secure cookies require HTTPS; engage them only when the public base URL is https. */
export function shouldUseSecureCookies(baseUrl: string): boolean {
  return baseUrl.startsWith('https://')
}

/**
 * Same-origin gate for mutating /api/v2/* requests (CSRF defense).
 *
 * When the operator has configured ALLOWED_ORIGINS (an exposed deployment),
 * only those exact origins are trusted. Otherwise — the loopback default — any
 * loopback origin on any port is accepted: `localhost`, `127.0.0.1`, and `[::1]`
 * are equivalent local origins. They must ALL be accepted, matching
 * better-auth's trusted-origins behaviour; allowing only `localhost` here meant
 * every mutation 404'd when the app was opened via `http://127.0.0.1:<port>`.
 */
export function isOriginAllowed(origin: string, allowedOriginsEnv: string | undefined): boolean {
  if (!origin) return false
  if (allowedOriginsEnv) {
    return allowedOriginsEnv
      .split(',')
      .map((o) => o.trim())
      .includes(origin)
  }
  return /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)
}
