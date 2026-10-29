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
// Spec 2026-08-21 (action-proxy name binding): the server-binding row is keyed by the
// package's OWN env identity (the possibly name-resolved embedded env spec oid), while the
// strict invoke body keeps the config oids byte-for-byte — binding answers "which server",
// the invoke oids are container-facing identity.
import { expect, test, vi } from 'vitest';
import { httpActionInvoker } from '../src/actions/invoker.js';
import { ActionInvokeFailed, ActionServerNotAllowed, type ActionClient } from '../src/actions/client.js';

const fakeClient = () =>
  ({
    invoke: vi.fn(async () => ({ instanceId: 'ai-1' })),
    capabilities: vi.fn(),
    invalidateCapabilities: vi.fn(),
  }) as unknown as ActionClient;

const ctx = (over: Record<string, unknown> = {}) => ({
  workCenterId: 'wc-1', environmentOid: 'env-cfg', actionOid: 'act-cfg',
  workflowInstanceId: 'wi-1', stepInstanceId: 'si-1', stepOid: 'step-1',
  inputParameters: [], matching: 'strict' as const,
  environmentName: null, actionName: null,
  ...over,
});

test('binding lookup keys by bindingEnvironmentOid; strict invoke body keeps the config oid', async () => {
  const client = fakeClient();
  const lookup = vi.fn(async () => 'http://server');
  const invoker = httpActionInvoker(client, lookup);
  const result = await invoker.begin(ctx({ bindingEnvironmentOid: 'env-resolved' }) as never);
  expect(result.ok).toBe(true);
  expect(lookup).toHaveBeenCalledWith('wc-1', 'env-resolved');
  const invokeMock = (client.invoke as ReturnType<typeof vi.fn>).mock;
  expect(invokeMock.calls[0][1]).toBe('act-cfg');
  expect(invokeMock.calls[0][2].environment_oid).toBe('env-cfg');
});

test('binding lookup falls back to environmentOid when bindingEnvironmentOid is absent', async () => {
  const client = fakeClient();
  const lookup = vi.fn(async () => 'http://server');
  const invoker = httpActionInvoker(client, lookup);
  await invoker.begin(ctx() as never);
  expect(lookup).toHaveBeenCalledWith('wc-1', 'env-cfg');
});

test('no-binding error names the oid that was actually looked up', async () => {
  const client = fakeClient();
  const invoker = httpActionInvoker(client, vi.fn(async () => null));
  const result = await invoker.begin(ctx({ bindingEnvironmentOid: 'env-resolved' }) as never);
  expect(result).toEqual({ ok: false, error: expect.stringContaining('environment "env-resolved" in this work center') });
});

test('no binding names the environment', async () => {
  const invoker = httpActionInvoker(fakeClient(), async () => null);
  const named = await invoker.begin(ctx({ environmentName: 'Line Env' }));
  expect(named).toEqual({ ok: false, error: 'No action server is bound for environment "Line Env" in this work center. Set it in Mission Commander under the work center\'s environment bindings.' });
  const unnamed = await invoker.begin(ctx());
  expect(unnamed).toMatchObject({ ok: false, error: expect.stringContaining('environment "env-cfg" in this work center') });
});

test('a 404 from the bound server names the action and suggests the binding', async () => {
  const client = { invoke: vi.fn(async () => { throw new ActionInvokeFailed(404, '{"error":{"code":"ACTION_NOT_FOUND"}}'); }) } as unknown as ActionClient;
  const res = await httpActionInvoker(client, async () => 'http://server').begin(ctx({ environmentName: 'Line Env', actionName: 'Heat' }));
  expect(res).toEqual({ ok: false, error: 'http://server has no action "Heat" for environment "Line Env". Check this environment\'s binding in this work center.' });
  const res2 = await httpActionInvoker(client, async () => 'http://server').begin(ctx());
  expect(res2).toEqual({ ok: false, error: 'http://server has no action "act-cfg" for environment "env-cfg". Check this environment\'s binding in this work center.' });
});

test('a non-allowlisted server names the environment', async () => {
  const client = { invoke: vi.fn(async () => { throw new ActionServerNotAllowed('http://evil'); }) } as unknown as ActionClient;
  const res = await httpActionInvoker(client, async () => 'http://evil').begin(ctx({ environmentName: 'Line Env' }));
  expect(res).toEqual({ ok: false, error: new ActionServerNotAllowed('http://evil').message + ' (environment "Line Env")' });
});
