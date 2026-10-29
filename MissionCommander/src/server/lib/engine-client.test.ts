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
import { afterEach, expect, test, vi } from 'vitest';
import { engineAssign, engineControl, engineForceRelease, EngineUnavailableError, engineWorkCenterResourceVerb, engineInstanceResourceVerb, engineSetWorkCenterValue, engineSetInstanceValue } from './engine-client';

const okResponse = () => new Response(JSON.stringify({ ok: true }), { status: 200 });

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

test('engineControl posts to the engine with the token header', async () => {
  vi.stubEnv('ENGINE_BASE_URL', 'http://engine.test:3006');
  vi.stubEnv('ENGINE_INTERNAL_TOKEN', 'tok-1');
  const fetchSpy = vi.fn(async () => okResponse());
  vi.stubGlobal('fetch', fetchSpy);
  const result = await engineControl('pause', 'abc-123');
  expect(result).toEqual({ ok: true });
  expect(fetchSpy).toHaveBeenCalledWith('http://engine.test:3006/internal/instances/abc-123/pause',
    { method: 'POST', headers: { 'x-internal-token': 'tok-1' } });
});

test('engineAssign posts the userId body with the token header', async () => {
  vi.stubEnv('ENGINE_BASE_URL', 'http://engine.test:3006');
  vi.stubEnv('ENGINE_INTERNAL_TOKEN', 'tok-1');
  const fetchSpy = vi.fn(async () => okResponse());
  vi.stubGlobal('fetch', fetchSpy);
  const result = await engineAssign('a-1', 'u-1');
  expect(result).toEqual({ ok: true });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('http://engine.test:3006/internal/assignments/a-1/assign');
  expect(init.method).toBe('POST');
  expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
  expect((init.headers as Record<string, string>)['x-internal-token']).toBe('tok-1');
  expect(JSON.parse(init.body as string)).toEqual({ userId: 'u-1' });
});

test('non-2xx passes status and the engine message through', async () => {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ error: { code: 'RUNTIME_INVALID_STATE', message: 'cannot pause from completed' } }), { status: 409 })));
  const result = await engineForceRelease('a-1');
  expect(result).toEqual({ ok: false, status: 409, message: 'cannot pause from completed' });
});

test('non-2xx with an unparseable body falls back to a generic message', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('gateway junk', { status: 502 })));
  const result = await engineControl('stop', 'x');
  expect(result).toEqual({ ok: false, status: 502, message: 'engine error 502' });
});

test('network failure throws EngineUnavailableError', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
  await expect(engineControl('abort', 'x')).rejects.toBeInstanceOf(EngineUnavailableError);
});

test('engineWorkCenterResourceVerb posts the body with the token and returns the engine summary', async () => {
  vi.stubEnv('ENGINE_BASE_URL', 'http://engine.test:3006');
  vi.stubEnv('ENGINE_INTERNAL_TOKEN', 'tok-1');
  const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true, summary: 'release-holder "Printer"', affectedInstanceIds: ['i1'] }), { status: 200 }));
  vi.stubGlobal('fetch', fetchSpy);
  const result = await engineWorkCenterResourceVerb('wc-1', 'release-holder', { name: 'Printer', holderId: 4, actorUserId: 'u-1' });
  expect(result).toEqual({ ok: true, summary: 'release-holder "Printer"' });
  const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('http://engine.test:3006/internal/work-centers/wc-1/resources/release-holder');
  expect(init.method).toBe('POST');
  expect((init.headers as Record<string, string>)['x-internal-token']).toBe('tok-1');
  expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
  expect(JSON.parse(init.body as string)).toEqual({ name: 'Printer', holderId: 4, actorUserId: 'u-1' });
});

test('engineInstanceResourceVerb carries a step-oid string waiterId (D16) and maps a 409 through', async () => {
  vi.stubEnv('ENGINE_BASE_URL', 'http://engine.test:3006');
  const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'NOT_SUPPORTED', message: 'a workflow-scoped resource has no holder ledger — use release' } }), { status: 409 }));
  vi.stubGlobal('fetch', fetchSpy);
  const result = await engineInstanceResourceVerb('i-1', 'cancel-waiter', { resourceKey: 'rt_1:Lock', waiterId: 's-pack', actorUserId: 'u-1' });
  expect(result).toEqual({ ok: false, status: 409, message: 'a workflow-scoped resource has no holder ledger — use release' });
  const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('http://engine.test:3006/internal/instances/i-1/resources/cancel-waiter');
  expect(JSON.parse(init.body as string)).toEqual({ resourceKey: 'rt_1:Lock', waiterId: 's-pack', actorUserId: 'u-1' });
});

test('value writes post to their two routes; a 2xx without a summary falls back to "Done"', async () => {
  vi.stubEnv('ENGINE_BASE_URL', 'http://engine.test:3006');
  const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchSpy);
  expect(await engineSetWorkCenterValue('wc-1', { propertyName: 'Batch', entryName: 'Size', value: '7', actorUserId: 'u-1' })).toEqual({ ok: true, summary: 'Done' });
  expect(await engineSetInstanceValue('i-1', { specOid: 'c-1', key: 'Sub.X', value: '2', actorUserId: 'u-1' })).toEqual({ ok: true, summary: 'Done' });
  const urls = fetchSpy.mock.calls.map((call) => (call as unknown as [string])[0]);
  expect(urls).toEqual(['http://engine.test:3006/internal/work-centers/wc-1/value-properties', 'http://engine.test:3006/internal/instances/i-1/value-properties']);
});

test('a verb call throws EngineUnavailableError on a network failure, like the controls', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
  await expect(engineWorkCenterResourceVerb('wc-1', 'reset', { name: 'Printer', actorUserId: 'u-1' })).rejects.toBeInstanceOf(EngineUnavailableError);
});
