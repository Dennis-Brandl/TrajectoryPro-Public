// @vitest-environment jsdom
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
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ApiError, apiErrorMessage, postForm, isUnauthenticatedRoute, setUnauthorizedHandler } from './client';
import { api } from './index';

const origFetch = global.fetch;
afterEach(() => { global.fetch = origFetch; });
function mockFetch(status: number, body: unknown) {
  global.fetch = vi.fn(async () => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as never;
}

describe('api client', () => {
  it('GET /api/work-centers with credentials', async () => {
    mockFetch(200, { nodes: [{ id: 'w1', name: 'Root', parentWorkCenterId: null, depth: 0, typeName: null }] });
    const out = await api.workCenters.list();
    expect(out.nodes[0].name).toBe('Root');
    expect(global.fetch).toHaveBeenCalledWith('/api/work-centers', expect.objectContaining({ credentials: 'include' }));
  });
  it('throws ApiError carrying the envelope code on error', async () => {
    mockFetch(409, { error: { code: 'conflict', message: 'dup name' } });
    await expect(api.workCenters.create({ name: 'x' })).rejects.toMatchObject({ status: 409, code: 'conflict' });
  });
  it('apiErrorMessage prefers the server message', () => {
    expect(apiErrorMessage(new ApiError(409, 'conflict', 'dup name'), 'fallback')).toBe('dup name');
    expect(apiErrorMessage(new Error('boom'), 'fallback')).toBe('fallback');
  });
  it('DELETE returns undefined on 204', async () => {
    mockFetch(204, null);
    await expect(api.workCenters.remove('w1')).resolves.toBeUndefined();
  });
});

describe('401 handling — a lost session must land the user on /login', () => {
  // Regression: the session cookie can vanish while the SPA sits open (browser cookie
  // clear, or signing in on localhost and returning on 127.0.0.1 — separate cookie jars).
  // _authenticated's beforeLoad only re-runs on NAVIGATION, so an idle tab kept rendering
  // and its mounted panels just refetched, toasted "Authentication required", and showed
  // empty panes. Nothing ever routed to /login.
  afterEach(() => setUnauthorizedHandler(null));

  it('invokes the unauthorized handler on 401', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    mockFetch(401, { error: { code: 'unauthorized', message: 'Authentication required' } });
    await expect(api.workCenters.list()).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('still throws the ApiError, so an in-flight caller can finish its own error path', async () => {
    setUnauthorizedHandler(vi.fn());
    mockFetch(401, { error: { code: 'unauthorized', message: 'Authentication required' } });
    await expect(api.workCenters.list()).rejects.toBeInstanceOf(ApiError);
  });

  it('does NOT fire on 403 — a permission failure is not a lost session', async () => {
    // Load-bearing: server-side, 401 comes ONLY from requireSession; every permission
    // denial is 403 (src/server/middleware/auth.ts). Redirecting a signed-in steward who
    // merely lacks a right would be a sign-out loop, so the trigger must stay 401-only.
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    mockFetch(403, { error: { code: 'forbidden', message: 'Missing permission: users.write' } });
    await expect(api.workCenters.create({ name: 'x' })).rejects.toMatchObject({ status: 403 });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('does not fire on a successful response', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    mockFetch(200, { nodes: [] });
    await api.workCenters.list();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('fires for multipart uploads too (postForm shares the same handler)', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    mockFetch(401, { error: { code: 'unauthorized', message: 'Authentication required' } });
    await expect(postForm('/api/workflows/import', new FormData())).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('isUnauthenticatedRoute shields /login and /setup from a redirect loop', () => {
    // A 401 raised BY the login or setup page (e.g. runBoot's /me during the guard chain)
    // must not bounce the browser to /login again — that reloads the document forever.
    expect(isUnauthenticatedRoute('/login')).toBe(true);
    expect(isUnauthenticatedRoute('/setup')).toBe(true);
    expect(isUnauthenticatedRoute('/')).toBe(false);
    expect(isUnauthenticatedRoute('/work-centers')).toBe(false);
    expect(isUnauthenticatedRoute('/libraries/abc')).toBe(false);
  });
});

describe('postForm', () => {
  it('sends the FormData as-is, with credentials and NO hand-set content-type', async () => {
    mockFetch(200, { workflowId: 'w1', nodeCount: 2, uiStepCount: 1, envCount: 0 });
    const form = new FormData();
    form.append('file', new File(['zip-bytes'], 'demo.WFmasterX'));

    const out = await postForm('/api/workflows/import', form);

    expect(out).toMatchObject({ workflowId: 'w1', nodeCount: 2 });
    const [path, init] = (global.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(path).toBe('/api/workflows/import');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.body).toBe(form); // the FormData itself, not a JSON string
    // Load-bearing: the browser must set content-type so the multipart boundary is
    // included. Any hand-set header here produces an unparseable body server-side.
    expect(init.headers).toBeUndefined();
  });

  it('surfaces the server error envelope like the other verbs', async () => {
    mockFetch(400, { error: { code: 'bad_request', message: 'Not a valid WFmasterX package' } });
    await expect(postForm('/api/workflows/import', new FormData()))
      .rejects.toMatchObject({ status: 400, code: 'bad_request', message: 'Not a valid WFmasterX package' });
  });
});
