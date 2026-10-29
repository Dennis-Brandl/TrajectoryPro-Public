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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ActionClient, ActionInvokeFailed, ActionsKeyRejected, ACTIONS_KEY_REJECTED_MESSAGE, BrokerTokenRejected, BROKER_TOKEN_REJECTED_MESSAGE,
  type InvokeRequest,
} from '../src/actions/client.js';
import { httpActionInvoker } from '../src/actions/invoker.js';
import { loadConfig } from '../src/config.js';

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); });

const TOKEN = 'b'.repeat(48);
const BROKER = 'http://mission-broker:3007';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function textResponse(status: number, text: string): Response { return new Response(text, { status }); }

const invokeBody: InvokeRequest = {
  environment_oid: 'env-1', workflow_instance_id: 'wf-1', step_instance_id: 'si-1', step_oid: 'step-1',
  input_parameters: [],
};
const CAPS = { data: { environments: [] } };

function mk() {
  return new ActionClient([BROKER, 'http://autopilot:3002'], fetchMock, { broker: { url: BROKER, token: TOKEN } });
}
const hdr = (i: number) => (fetchMock.mock.calls[i][1].headers ?? {}) as Record<string, string>;

describe('broker token', () => {
  it('invoke to the broker carries the token; to another server it does not', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(201, { data: { instance_id: 'i1' } }));
    const c = mk();
    await c.invoke(BROKER, 'a', invokeBody);
    await c.invoke('http://autopilot:3002', 'a', invokeBody);
    expect(hdr(0).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(hdr(0)['Content-Type']).toBe('application/json');
    expect(hdr(1).Authorization).toBeUndefined();
  });

  it('localhost and 127.0.0.1 are different origins', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: { state: 'RUNNING', outputs: [] } }));
    const c = new ActionClient(['http://127.0.0.1:3007'], fetchMock, { broker: { url: 'http://localhost:3007', token: TOKEN } });
    await c.getInstance('http://127.0.0.1:3007', 'i1');
    expect(hdr(0).Authorization).toBeUndefined();
  });

  it('poll, command, delete and capabilities carry the token', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/capabilities') ? jsonResponse(200, CAPS) : jsonResponse(200, { data: { state: 'RUNNING', outputs: [] } }));
    const c = mk();
    await c.getInstance(BROKER, 'i1');
    await c.sendCommand(BROKER, 'i1', 'PAUSE');
    await c.deleteInstance(BROKER, 'i1');
    await c.capabilities(BROKER);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (let i = 0; i < 4; i++) expect(hdr(i).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('the instance event stream carries the token', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    const h = await mk().subscribeInstanceEvents(BROKER, 'i1', () => {});
    await new Promise((r) => setTimeout(r, 10));
    h.close();
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Accept: 'text/event-stream', Authorization: `Bearer ${TOKEN}` });
  });

  it('a broker 401 becomes the spec message', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(401, { error: 'missing or wrong broker token' }));
    const c = mk();
    const err = await c.invoke(BROKER, 'a', invokeBody).catch((e) => e);
    expect(err).toBeInstanceOf(BrokerTokenRejected);
    expect(err.message).toBe(BROKER_TOKEN_REJECTED_MESSAGE);
    await expect(c.capabilities(BROKER)).rejects.toBeInstanceOf(BrokerTokenRejected);
  });

  it('a 401 from another server keeps its ordinary error', async () => {
    fetchMock.mockResolvedValue(textResponse(401, 'nope'));
    const err = await mk().invoke('http://autopilot:3002', 'a', invokeBody).catch((e) => e);
    expect(err).toBeInstanceOf(ActionInvokeFailed);
    expect(err.status).toBe(401);
  });

  it('loose matching reports the broker refusal in the step error', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'missing or wrong broker token' }));
    const c = new ActionClient(['http://127.0.0.1:3007'], fetchMock, { broker: { url: 'http://localhost:3007', token: TOKEN } });
    const invoker = httpActionInvoker(c, async () => 'http://127.0.0.1:3007');
    const res = await invoker.begin({
      workCenterId: 'wc', environmentOid: 'env-w', actionOid: 'act-w',
      workflowInstanceId: 'wi', stepInstanceId: 'si', stepOid: 'so',
      inputParameters: [], matching: 'loose' as const, environmentName: 'Kitchen', actionName: 'PreheatOven',
    });
    expect(res).toEqual({ ok: false, error: BROKER_TOKEN_REJECTED_MESSAGE });
  });
});

describe('broker config', () => {
  const base = { DATABASE_URL: 'postgres://x/y' };
  it('both set gives broker', () => {
    expect(loadConfig({ ...base, MISSION_BROKER_URL: BROKER, MISSION_BROKER_TOKEN: TOKEN } as any).broker)
      .toEqual({ url: BROKER, token: TOKEN });
  });
  it('trims the token', () => {
    expect(loadConfig({ ...base, MISSION_BROKER_URL: BROKER, MISSION_BROKER_TOKEN: TOKEN + '\r' } as any).broker?.token).toBe(TOKEN);
  });
  it('rejects a non-http url', () => {
    expect(() => loadConfig({ ...base, MISSION_BROKER_URL: 'ftp://x', MISSION_BROKER_TOKEN: TOKEN } as any)).toThrow(/MISSION_BROKER_URL/);
  });
  it('a token alone gives null and warns outside tests', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const saved = process.env.VITEST;
    delete process.env.VITEST;
    try {
      const cfg = loadConfig({ ...base, BETTER_AUTH_SECRET: 's', ENGINE_INTERNAL_TOKEN: 't', MISSION_BROKER_TOKEN: TOKEN } as any);
      expect(cfg.broker).toBeNull();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toMatch(/MISSION_BROKER_URL/);
    } finally {
      if (saved === undefined) delete process.env.VITEST; else process.env.VITEST = saved;
      warnSpy.mockRestore();
    }
  });
});

describe('Mission Autopilot key', () => {
  const ACTIONS = 'http://mission-autopilot-server:3002';
  const KEY = 'k'.repeat(32);
  const mkA = () => new ActionClient([BROKER, ACTIONS, 'http://other:3002'], fetchMock, {
    broker: { url: BROKER, token: TOKEN }, actions: { url: ACTIONS, key: KEY },
  });
  const UNAUTH = { error: { code: 'UNAUTHORIZED', message: 'Invalid or missing API key', details: {} } };

  it('capabilities to the actions origin sends X-API-Key and no Authorization', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, CAPS));
    await mkA().capabilities(ACTIONS);
    expect(hdr(0)['X-API-Key']).toBe(KEY);
    expect(hdr(0).Authorization).toBeUndefined();
  });

  it('another origin gets neither; the broker gets only the Bearer', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, CAPS));
    const c = mkA();
    await c.capabilities('http://other:3002');
    await c.capabilities(BROKER);
    expect(hdr(0)['X-API-Key']).toBeUndefined();
    expect(hdr(0).Authorization).toBeUndefined();
    expect(hdr(1).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(hdr(1)['X-API-Key']).toBeUndefined();
  });

  it('event streams to the actions origin carry X-API-Key', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    const c = mkA();
    const h1 = await c.subscribeInstanceEvents(ACTIONS, 'i1', () => {});
    const h2 = await c.subscribePropertyEvents(ACTIONS, 'g', 'env-1', { onEvent: () => {}, onEnd: () => {} } as any);
    await new Promise((r) => setTimeout(r, 10));
    h1.close(); h2.close();
    expect(fetchMock.mock.calls[0][1].headers['X-API-Key']).toBe(KEY);
    expect(fetchMock.mock.calls[1][1].headers['X-API-Key']).toBe(KEY);
  });

  it('a 401 from the actions origin becomes ActionsKeyRejected', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(401, UNAUTH));
    const c = mkA();
    const err = await c.invoke(ACTIONS, 'a', invokeBody).catch((e) => e);
    expect(err).toBeInstanceOf(ActionsKeyRejected);
    expect(err.message).toBe(ACTIONS_KEY_REJECTED_MESSAGE);
    await expect(c.capabilities(ACTIONS)).rejects.toBeInstanceOf(ActionsKeyRejected);
    await expect(c.getProperty(ACTIONS, 'g', 'env-1')).rejects.toBeInstanceOf(ActionsKeyRejected);
  });

  it('a 401 from an unrelated origin keeps its ordinary error', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, UNAUTH));
    const err = await mkA().invoke('http://other:3002', 'a', invokeBody).catch((e) => e);
    expect(err).toBeInstanceOf(ActionInvokeFailed);
  });
});
