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
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runtimeHistory } from './runtime-history';

const okJson = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
// Typed like `fetch` itself so `.mock.calls[0]` indexes as [url, init] rather than the `[]`
// vitest would otherwise infer from a zero-arg mock body.
const stubFetch = (body: unknown) => {
  const fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => okJson(body));
  vi.stubGlobal('fetch', fetchSpy);
  return fetchSpy;
};

afterEach(() => vi.unstubAllGlobals());

// Final-review Finding 1: `datetime-local` inputs (HistoryFilters' from/to, PurgeDialog's
// olderThan) hand back a bare local string like '2026-08-01T00:00' with no timezone. The
// server's `z.coerce.date()` resolves that string in ITS OWN zone (UTC in docker), not the
// browser's, so a UTC+2 admin's "purge older than Aug 1 00:00" would cut at 02:00 local.
// `new Date(local)` parses the same bare string as LOCAL time (the browser rule), and
// `.toISOString()` re-serializes it as an absolute instant with that offset already applied
// -- spec §7: "sent as ISO with the browser's offset".
describe('runtimeHistory wire format — datetime-local converted to an ISO instant', () => {
  it('listForWorkCenter sends from/to as ISO instants in the query string', async () => {
    const fetchSpy = stubFetch({ history: [], total: 0, page: 1, pageSize: 50 });
    const local = '2026-08-01T00:00';
    const expectedIso = new Date(local).toISOString();

    await runtimeHistory.listForWorkCenter('w1', { from: local, to: local });

    const url = new URL(fetchSpy.mock.calls[0][0].toString(), 'http://x');
    expect(url.searchParams.get('from')).toBe(expectedIso);
    expect(url.searchParams.get('to')).toBe(expectedIso);
  });

  it('listAll sends from as an ISO instant and omits an unset to', async () => {
    const fetchSpy = stubFetch({ history: [], total: 0, page: 1, pageSize: 50 });
    const local = '2026-08-01T00:00';
    const expectedIso = new Date(local).toISOString();

    await runtimeHistory.listAll({ from: local });

    const url = new URL(fetchSpy.mock.calls[0][0].toString(), 'http://x');
    expect(url.searchParams.get('from')).toBe(expectedIso);
    expect(url.searchParams.has('to')).toBe(false);
  });

  it('leaves other params untouched and omits from/to entirely when unset', async () => {
    const fetchSpy = stubFetch({ history: [], total: 0, page: 1, pageSize: 50 });

    await runtimeHistory.listForWorkCenter('w1', { page: 2, state: 'completed' });

    const url = new URL(fetchSpy.mock.calls[0][0].toString(), 'http://x');
    expect(url.searchParams.has('from')).toBe(false);
    expect(url.searchParams.has('to')).toBe(false);
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('state')).toBe('completed');
  });

  it('purgeCount sends olderThan as an ISO instant in the query string', async () => {
    const fetchSpy = stubFetch({ count: 3 });
    const local = '2026-08-01T00:00';
    const expectedIso = new Date(local).toISOString();

    await runtimeHistory.purgeCount({ olderThan: local });

    const url = new URL(fetchSpy.mock.calls[0][0].toString(), 'http://x');
    expect(url.searchParams.get('olderThan')).toBe(expectedIso);
  });

  it('purge sends olderThan as an ISO instant in the request body', async () => {
    const fetchSpy = stubFetch({ deleted: 5 });
    const local = '2026-08-01T00:00';
    const expectedIso = new Date(local).toISOString();

    await runtimeHistory.purge({ olderThan: local, workCenterId: 'w1' });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/runtime-history/purge');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ olderThan: expectedIso, workCenterId: 'w1' });
  });
});
