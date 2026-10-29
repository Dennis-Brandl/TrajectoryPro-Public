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
//
// Spec 2026-09-05: copy of mission-control-db's `normalizeActionServerOrigin`
// (src/dao/system-settings.ts is the source of truth). Copied rather than
// imported so the CM client bundle never pulls a runtime VALUE from the db
// package (today it only imports types from 'mission-control-db').

/** Parses a user-entered action-server origin: http(s) only, no path/query/hash (a path is
 *  the classic "pasted /trajectory/v1/" mistake — clients add the protocol path themselves). */
export function normalizeActionServerOrigin(input: string): { ok: true; origin: string } | { ok: false; reason: string } {
  let url: URL;
  try { url = new URL(input.trim()); } catch { return { ok: false, reason: 'not a valid URL' }; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'must start with http:// or https://' };
  if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    return { ok: false, reason: 'must be an origin only (scheme, host, port) — no path' };
  }
  return { ok: true, origin: url.origin };
}
