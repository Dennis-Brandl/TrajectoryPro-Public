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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { load } from './load';
import { ApiError } from './client';

const fetchMock = vi.fn();
const realFetch = globalThis.fetch;
beforeEach(() => { fetchMock.mockReset(); globalThis.fetch = fetchMock as never; });
afterEach(() => { globalThis.fetch = realFetch; });

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}
const file = (name: string) => new File([new Uint8Array([1])], name);
const initOf = () => fetchMock.mock.calls[0][1] as RequestInit;

describe('load client', () => {
  it('posts multipart to the work center, one file part per file', async () => {
    fetchMock.mockResolvedValue(okJson({ results: [] }));
    const a = file('a.WFmasterX');
    const b = file('b.WFenvirX');

    await load.load('wc-1', [a, b], []);

    expect(fetchMock.mock.calls[0][0]).toBe('/api/work-centers/wc-1/load');
    expect(initOf().method).toBe('POST');
    expect((initOf().body as FormData).getAll('file')).toHaveLength(2);
  });

  it('never sets content-type by hand', async () => {
    fetchMock.mockResolvedValue(okJson({ results: [] }));
    await load.load('wc-1', [file('a.WFmasterX')], []);
    // The boundary must come from the FormData itself; hand-setting content-type drops it
    // and the server cannot parse the parts.
    expect(initOf().headers).toBeUndefined();
    expect(initOf().credentials).toBe('include');
  });

  it('sends one alsoWorkCenterId part per extra target', async () => {
    fetchMock.mockResolvedValue(okJson({ results: [] }));
    await load.load('wc-1', [file('a.WFmasterX')], ['wc-2', 'wc-3']);
    expect((initOf().body as FormData).getAll('alsoWorkCenterId')).toEqual(['wc-2', 'wc-3']);
  });

  it('omits alsoWorkCenterId entirely when there are no extras', async () => {
    fetchMock.mockResolvedValue(okJson({ results: [] }));
    await load.load('wc-1', [file('a.WFmasterX')], []);
    expect((initOf().body as FormData).getAll('alsoWorkCenterId')).toEqual([]);
  });

  it('returns the results array verbatim', async () => {
    const results = [{ filename: 'a.WFmasterX', workCenterId: 'wc-1', kind: 'workflow', status: 'loaded' }];
    fetchMock.mockResolvedValue(okJson({ results }));
    expect(await load.load('wc-1', [file('a.WFmasterX')], [])).toEqual({ results });
  });
});

describe('ApiError carries the parsed body', () => {
  it('exposes a 409 impact summary to the caller', async () => {
    // DeleteWorkCenterDialog renders the counts off this. Without the body retained,
    // the two-call delete cannot show the user what a confirmed delete would destroy —
    // and the failure is silent, because message and status still look correct.
    const impact = { workflows: 2, environments: 1, instances: 3, stepInstances: 9, schedules: 0, hasChildren: false };
    fetchMock.mockResolvedValue({
      ok: false, status: 409,
      json: async () => ({ error: { code: 'conflict', message: 'has artifacts', impact } }),
    } as unknown as Response);

    const err = await load.load('wc-1', [file('a.WFmasterX')], []).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).body).toMatchObject({ error: { impact } });
  });
});
