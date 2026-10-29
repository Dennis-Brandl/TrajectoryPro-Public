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
import { get, post, del } from './client';
import type { RuntimeHistoryDetail, RuntimeHistoryListParams, RuntimeHistoryPage } from './types';

// Shared query-string builder: omits undefined/empty/false entries so callers can pass a
// params object straight through without hand-pruning it first. `true` serializes to the
// literal string 'true' (the server's `orphans` flag is a z.literal('true') check).
function qs(params: Record<string, string | number | boolean | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    if (value === false) continue;
    q.set(key, value === true ? 'true' : String(value));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

// `datetime-local` inputs (HistoryFilters' from/to, PurgeDialog's olderThan) hand back a bare
// local string like '2026-08-01T00:00' with no timezone. The server's `z.coerce.date()`
// (src/server/routes/runtime-history.ts) resolves that string in ITS OWN zone (UTC in
// docker), not the browser's — so a UTC+2 admin's "purge older than Aug 1 00:00" would
// actually cut at 02:00 local. `new Date(v)` parses the same bare string as LOCAL time (the
// browser rule for datetime-local strings), and `.toISOString()` re-serializes it as an
// absolute instant with that offset already applied — so the wire value names the same
// instant no matter which zone the server runs in (spec §7: "sent as ISO with the browser's
// offset"). Guarded on empty so an unset field passes through rather than becoming
// "Invalid Date" (`new Date('').toISOString()` throws).
const toIso = (v: string): string => (v === '' ? v : new Date(v).toISOString());

export const runtimeHistory = {
  // Scoped route: `/api/work-centers/:id/runtime-history` — the server's listQuery is
  // `.strict()` and has no workCenterId/orphans fields, so callers must not set those here.
  listForWorkCenter: (workCenterId: string, params: RuntimeHistoryListParams = {}) =>
    get(`/api/work-centers/${workCenterId}/runtime-history${qs({
      ...params,
      from: params.from !== undefined ? toIso(params.from) : undefined,
      to: params.to !== undefined ? toIso(params.to) : undefined,
    })}`) as Promise<RuntimeHistoryPage>,
  // Cross-work-center route: `/api/runtime-history` — accepts workCenterId and orphans
  // (mutually exclusive server-side).
  listAll: (params: RuntimeHistoryListParams = {}) =>
    get(`/api/runtime-history${qs({
      ...params,
      from: params.from !== undefined ? toIso(params.from) : undefined,
      to: params.to !== undefined ? toIso(params.to) : undefined,
    })}`) as Promise<RuntimeHistoryPage>,
  detail: (id: string) => get(`/api/runtime-history/${id}`) as Promise<RuntimeHistoryDetail>,
  remove: (id: string) => del(`/api/runtime-history/${id}`) as Promise<undefined>,
  purgeCount: (opts: { olderThan: string; workCenterId?: string }) =>
    get(`/api/runtime-history/purge-count${qs({ ...opts, olderThan: toIso(opts.olderThan) })}`) as Promise<{ count: number }>,
  purge: (opts: { olderThan: string; workCenterId?: string }) =>
    post('/api/runtime-history/purge', { ...opts, olderThan: toIso(opts.olderThan) }) as Promise<{ deleted: number }>,
};
