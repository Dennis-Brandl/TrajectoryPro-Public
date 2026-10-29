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
// Task 14: action REST client, SSE parser, protocol stub server. Semantics ported from the
// reference repo's engines/web-ui/src/actionProxy/ActionApiClient.ts + SseObserver.ts, adapted
// per task-14-brief.md's ambiguity rulings:
//   - invoke non-201 -> plain Error carrying status + body text (no new error class)
//   - only getInstance's 404 gets the typed ActionInstanceLost
//   - allowlist check is exact-origin match (new URL(serverUri).origin), no prefix matching;
//     an empty allowlist always throws ActionServerNotAllowed
//   - capabilities cache: 5-minute TTL, per-ActionClient-instance, keyed by server origin
//   - SSE parser: no reconnect, no Last-Event-ID resume; stop silently on error/close
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import {
  ActionClient,
  ActionInstanceLost,
  ActionServerNotAllowed,
  ActionStatusFailed,
  staticPolicy,
  type ActionServerPolicySource,
  type FetchLike,
  type InvokeRequest,
} from '../src/actions/client.js';
import { subscribeSse, type ActionEvent } from '../src/actions/sse.js';
import { startStubActionServer, type StubActionServer } from './stub-action-server.js';

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); });

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function textResponse(status: number, text: string): Response {
  return new Response(text, { status });
}

const invokeBody: InvokeRequest = {
  environment_oid: 'env-1',
  workflow_instance_id: 'wf-1',
  step_instance_id: 'si-1',
  step_oid: 'step-1',
  input_parameters: [{ name: 'target_temperature', value: '200' }],
};

describe('ActionClient allowlist gating', () => {
  it('rejects a non-listed origin before any fetch', async () => {
    const client = new ActionClient(['http://allowed.example:9000'], fetchMock);
    await expect(client.invoke('http://evil.example', 'act-1', invokeBody)).rejects.toBeInstanceOf(ActionServerNotAllowed);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws for every method when the allowlist is empty', async () => {
    const client = new ActionClient([], fetchMock);
    await expect(client.invoke('http://localhost:3002', 'act-1', invokeBody)).rejects.toBeInstanceOf(ActionServerNotAllowed);
    await expect(client.getInstance('http://localhost:3002', 'ai-1')).rejects.toBeInstanceOf(ActionServerNotAllowed);
    await expect(client.sendCommand('http://localhost:3002', 'ai-1', 'PAUSE')).rejects.toBeInstanceOf(ActionServerNotAllowed);
    await expect(client.deleteInstance('http://localhost:3002', 'ai-1')).rejects.toBeInstanceOf(ActionServerNotAllowed);
    await expect(client.capabilities('http://localhost:3002')).rejects.toBeInstanceOf(ActionServerNotAllowed);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('matches origins exactly — same host, different port is not allowed (no prefix matching)', async () => {
    const client = new ActionClient(['http://localhost:3002'], fetchMock);
    await expect(client.invoke('http://localhost:3003', 'act-1', invokeBody)).rejects.toBeInstanceOf(ActionServerNotAllowed);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('ActionClient policy source (spec 2026-09-05)', () => {
  it('loose trust contacts an unlisted origin and warns once per origin', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // mockImplementation (not mockResolvedValue) — each fetch call needs its OWN Response
    // instance since a body can only be read (.json()) once; two invoke() calls share one mock.
    fetchMock.mockImplementation(() => jsonResponse(201, { data: { instance_id: 'ai-1' } }));
    const client = new ActionClient(staticPolicy([], 'loose'), fetchMock);
    await client.invoke('http://unlisted:3002', 'act-1', invokeBody);
    await client.invoke('http://unlisted:3002', 'act-2', invokeBody);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('LOOSE');
    expect(warn.mock.calls[0]![0]).toContain('http://unlisted:3002');
    warn.mockRestore();
  });
  it('loose trust still rejects a non-http(s) URL', async () => {
    const client = new ActionClient(staticPolicy([], 'loose'), fetchMock);
    await expect(client.getInstance('ftp://x', 'ai-1')).rejects.toBeInstanceOf(ActionServerNotAllowed);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('re-reads the policy on every call (a flip takes effect on the next call)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { data: { instance_id: 'ai-1' } }));
    let policy = { trust: 'strict' as const, allowlist: [] as string[] };
    const source: ActionServerPolicySource = async () => policy;
    const client = new ActionClient(source, fetchMock);
    await expect(client.invoke('http://later:3002', 'act-1', invokeBody)).rejects.toBeInstanceOf(ActionServerNotAllowed);
    policy = { trust: 'strict', allowlist: ['http://later:3002'] };
    await client.invoke('http://later:3002', 'act-1', invokeBody);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('the rejection names the Mission Commander setting', async () => {
    const client = new ActionClient([], fetchMock);
    await expect(client.invoke('http://x:1', 'act-1', invokeBody)).rejects.toThrow(/Settings → Action server trust/);
  });
  it('isAllowed is public and mirrors the fetch gate', async () => {
    const client = new ActionClient(['http://a:1'], fetchMock);
    expect(await client.isAllowed('http://a:1')).toBe(true);
    expect(await client.isAllowed('http://b:1')).toBe(false);
    expect(await client.isAllowed('garbage')).toBe(false);
  });
});

describe('ActionClient.invoke', () => {
  it('happy path: asserts URL, method, body; returns instanceId on 201', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { data: { instance_id: 'ai-1' } }));
    const client = new ActionClient(['http://localhost:3002'], fetchMock);

    const { instanceId } = await client.invoke('http://localhost:3002', 'act-1', invokeBody);

    expect(instanceId).toBe('ai-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3002/trajectory/v1/actions/act-1/invoke');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(invokeBody);
  });

  it('non-201 response throws a plain Error carrying status + body text', async () => {
    fetchMock.mockResolvedValue(textResponse(500, 'boom'));
    const client = new ActionClient(['http://localhost:3002'], fetchMock);

    const err = await client.invoke('http://localhost:3002', 'act-1', invokeBody).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ActionServerNotAllowed);
    expect(err).not.toBeInstanceOf(ActionInstanceLost);
    expect((err as Error).message).toContain('500');
    expect((err as Error).message).toContain('boom');
  });
});

describe('ActionClient.getInstance', () => {
  it('returns the parsed snapshot on 200', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: { state: 'RUNNING', outputs: [{ name: 'x', value: '1' }] } }));
    const client = new ActionClient(['http://localhost:3002'], fetchMock);

    const snap = await client.getInstance('http://localhost:3002', 'ai-1');
    expect(snap).toEqual({ state: 'RUNNING', outputs: [{ name: 'x', value: '1' }] });
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3002/trajectory/v1/instances/ai-1');
  });

  it('404 -> throws the typed ActionInstanceLost', async () => {
    fetchMock.mockResolvedValue(textResponse(404, 'gone'));
    const client = new ActionClient(['http://localhost:3002'], fetchMock);

    await expect(client.getInstance('http://localhost:3002', 'ai-1')).rejects.toBeInstanceOf(ActionInstanceLost);
  });

  it('non-404 non-200 -> plain Error, not ActionInstanceLost', async () => {
    fetchMock.mockResolvedValue(textResponse(503, 'unavailable'));
    const client = new ActionClient(['http://localhost:3002'], fetchMock);

    const err = await client.getInstance('http://localhost:3002', 'ai-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ActionInstanceLost);
  });

  it('503 -> throws ActionStatusFailed carrying the status', async () => {
    fetchMock.mockResolvedValue(textResponse(503, 'unavailable'));
    const client = new ActionClient(['http://localhost:3002'], fetchMock);

    const err = await client.getInstance('http://localhost:3002', 'ai-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ActionStatusFailed);
    expect((err as ActionStatusFailed).status).toBe(503);
    expect((err as Error).message).toBe('action getInstance failed (503): unavailable');
  });
});

describe('ActionClient.sendCommand', () => {
  it('409 (invalid transition) resolves — commands are best-effort', async () => {
    fetchMock.mockResolvedValue(textResponse(409, 'invalid transition'));
    const client = new ActionClient(['http://localhost:3002'], fetchMock);

    await expect(client.sendCommand('http://localhost:3002', 'ai-1', 'PAUSE')).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3002/trajectory/v1/instances/ai-1/command');
    expect(JSON.parse(init.body as string)).toEqual({ command: 'PAUSE' });
  });

  it('200 resolves', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: { accepted: true } }));
    const client = new ActionClient(['http://localhost:3002'], fetchMock);
    await expect(client.sendCommand('http://localhost:3002', 'ai-1', 'RESUME')).resolves.toBeUndefined();
  });

  it('other statuses throw', async () => {
    fetchMock.mockResolvedValue(textResponse(500, 'boom'));
    const client = new ActionClient(['http://localhost:3002'], fetchMock);
    await expect(client.sendCommand('http://localhost:3002', 'ai-1', 'PAUSE')).rejects.toBeInstanceOf(Error);
  });
});

describe('ActionClient.deleteInstance', () => {
  it('is best-effort and swallows a thrown network error', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    const client = new ActionClient(['http://localhost:3002'], fetchMock);
    await expect(client.deleteInstance('http://localhost:3002', 'ai-1')).resolves.toBeUndefined();
  });

  it('is best-effort and swallows a non-2xx response', async () => {
    fetchMock.mockResolvedValue(textResponse(500, 'boom'));
    const client = new ActionClient(['http://localhost:3002'], fetchMock);
    await expect(client.deleteInstance('http://localhost:3002', 'ai-1')).resolves.toBeUndefined();
  });

  it('still gates on the allowlist first (not swallowed)', async () => {
    const client = new ActionClient(['http://allowed.example'], fetchMock);
    await expect(client.deleteInstance('http://evil.example', 'ai-1')).rejects.toBeInstanceOf(ActionServerNotAllowed);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('ActionClient.capabilities', () => {
  it('caches for 5 minutes — second call within the TTL makes no new fetch', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {
      data: {
        environments: [{
          environment_oid: 'env-1', environment_name: 'Env One',
          actions: [{
            action_oid: 'act-1', action_name: 'Act One', visibility: 'observable',
            input_parameters: [], supported_commands: ['PAUSE', 'RESUME'],
          }],
        }],
      },
    }));
    const client = new ActionClient(['http://localhost:3002'], fetchMock);

    const first = await client.capabilities('http://localhost:3002');
    const second = await client.capabilities('http://localhost:3002');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first.byActionOid.get('act-1')).toEqual({ supportedCommands: ['PAUSE', 'RESUME'], opaque: false });
  });

  it('refetches once the TTL has elapsed', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    // mockImplementation (not mockResolvedValue) so each call gets a fresh Response — a
    // Response body can only be read once, and this test deliberately calls capabilities()
    // twice expecting two real fetches.
    fetchMock.mockImplementation(() => jsonResponse(200, {
      data: {
        environments: [{
          environment_oid: 'env-1', environment_name: 'Env One',
          actions: [{
            action_oid: 'act-1', action_name: 'Act One', visibility: 'opaque',
            input_parameters: [], supported_commands: ['ABORT'],
          }],
        }],
      },
    }));
    const client = new ActionClient(['http://localhost:3002'], fetchMock);

    await client.capabilities('http://localhost:3002');
    now.mockReturnValue(1_000_000 + 5 * 60 * 1000 + 1);
    await client.capabilities('http://localhost:3002');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it('opaque is derived from visibility === "opaque"', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {
      data: {
        environments: [{
          environment_oid: 'env-1', environment_name: 'Env One',
          actions: [{
            action_oid: 'act-1', action_name: 'Act One', visibility: 'opaque',
            input_parameters: [], supported_commands: ['ABORT'],
          }],
        }],
      },
    }));
    const client = new ActionClient(['http://localhost:3002'], fetchMock);
    const caps = await client.capabilities('http://localhost:3002');
    expect(caps.byActionOid.get('act-1')?.opaque).toBe(true);
  });
});

describe('ActionClient.getProperty', () => {
  it('returns the parsed property group on 200', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {
      data: { environment_oid: 'env-1', name: 'Sensor', entries: [{ name: 'Value', value: '42' }] },
    }));
    const client = new ActionClient(['http://localhost:3002'], fetchMock);

    const result = await client.getProperty('http://localhost:3002', 'Sensor', 'env-1');

    expect(result).toEqual({ environmentOid: 'env-1', name: 'Sensor', entries: [{ name: 'Value', value: '42' }] });
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3002/trajectory/v1/properties/Sensor?environment_oid=env-1');
  });

  it('404 rejects with a message containing the status', async () => {
    fetchMock.mockResolvedValue(textResponse(404, 'not found'));
    const client = new ActionClient(['http://localhost:3002'], fetchMock);

    const err = await client.getProperty('http://localhost:3002', 'Sensor', 'env-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('404');
  });
});

// ── SSE parser ──

function sseStreamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream);
}

describe('subscribeSse', () => {
  it('parses a two-event chunked stream and dispatches both events', async () => {
    const received: ActionEvent[] = [];
    // Split mid-event across chunk boundaries to prove buffering across reads works.
    const chunks = [
      'id: 1\nevent: state_change\ndata: {"state":"RUNNING","previous_state":"IDLE",',
      '"timestamp":"2026-01-01T00:00:00Z"}\n\n',
      'id: 2\nevent: output\ndata: {"outputs":[{"name":"actual_temperature","value":"198.5"}],"timestamp":"2026-01-01T00:00:01Z"}\n\n',
    ];
    const mockFetch = vi.fn().mockResolvedValue(sseStreamResponse(chunks));

    const handle = subscribeSse('http://localhost:3002', 'ai-1', (e) => received.push(e), mockFetch);
    await vi.waitFor(() => expect(received.length).toBe(2));

    expect(received[0]).toMatchObject({ kind: 'state_change', state: 'RUNNING', previous_state: 'IDLE', eventId: 1 });
    expect(received[1]).toMatchObject({
      kind: 'output',
      outputs: [{ name: 'actual_temperature', value: '198.5' }],
      eventId: 2,
    });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3002/trajectory/v1/instances/ai-1/events');
    expect((init.headers as Record<string, string>).Accept).toBe('text/event-stream');

    handle.close();
  });

  it('dispatches log and heartbeat events', async () => {
    const received: ActionEvent[] = [];
    const chunks = [
      'event: log\ndata: {"stream":"stderr","message":"boom","timestamp":"t1"}\n\n' +
      'event: heartbeat\ndata: {"timestamp":"t2"}\n\n',
    ];
    const mockFetch = vi.fn().mockResolvedValue(sseStreamResponse(chunks));

    const handle = subscribeSse('http://localhost:3002', 'ai-2', (e) => received.push(e), mockFetch);
    await vi.waitFor(() => expect(received.length).toBe(2));

    expect(received[0]).toMatchObject({ kind: 'log', stream: 'stderr', message: 'boom' });
    expect(received[1]).toMatchObject({ kind: 'heartbeat', ts: 't2' });
    handle.close();
  });

  it('close() stops dispatching further events, even one already in flight', async () => {
    const received: ActionEvent[] = [];
    let resolveGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => { resolveGate = resolve; });
    const encoder = new TextEncoder();
    let pullCount = 0;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        pullCount++;
        if (pullCount === 1) {
          controller.enqueue(encoder.encode('event: heartbeat\ndata: {"timestamp":"t1"}\n\n'));
          return;
        }
        await gate;
        controller.enqueue(encoder.encode('event: heartbeat\ndata: {"timestamp":"t2"}\n\n'));
        controller.close();
      },
    });
    const mockFetch = vi.fn().mockResolvedValue(new Response(stream));

    const handle = subscribeSse('http://localhost:3002', 'ai-3', (e) => received.push(e), mockFetch);
    await vi.waitFor(() => expect(received.length).toBe(1));

    handle.close();
    resolveGate();
    await new Promise((r) => setTimeout(r, 20));

    expect(received.length).toBe(1);
  });

  it('stops silently (no throw) when the fetch itself rejects', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('network down'));
    expect(() => subscribeSse('http://localhost:3002', 'ai-4', () => {}, mockFetch)).not.toThrow();
    // give the internal async IIFE a tick to run and swallow the rejection
    await new Promise((r) => setTimeout(r, 10));
  });
});

// ── Stub action server round trip ──

describe('stub action server', () => {
  let stub: StubActionServer;

  afterEach(async () => {
    if (stub) await stub.close();
  });

  it('invoke -> advance -> snapshot shows the new state -> SSE delivers the state_change', async () => {
    stub = startStubActionServer(0);
    const client = new ActionClient([new URL(stub.uri).origin]);

    const { instanceId } = await client.invoke(stub.uri, 'act-1', invokeBody);

    const snapAfterInvoke = await client.getInstance(stub.uri, instanceId);
    expect(snapAfterInvoke.state).toBe('IDLE');

    const received: ActionEvent[] = [];
    const handle = subscribeSse(stub.uri, instanceId, (e) => received.push(e));
    // let the SSE GET establish before the transition it must observe
    await new Promise((r) => setTimeout(r, 100));

    stub.control.advance(instanceId, 'RUNNING');

    const snap = await client.getInstance(stub.uri, instanceId);
    expect(snap.state).toBe('RUNNING');

    await vi.waitFor(
      () => expect(received.some((e) => e.kind === 'state_change' && e.state === 'RUNNING')).toBe(true),
      { timeout: 2000 },
    );

    handle.close();
  });

  it('command table: RUNNING accepts PAUSE, rejects RESUME (409)', async () => {
    stub = startStubActionServer(0);
    const client = new ActionClient([new URL(stub.uri).origin]);
    const { instanceId } = await client.invoke(stub.uri, 'act-1', invokeBody);
    stub.control.advance(instanceId, 'RUNNING');

    await client.sendCommand(stub.uri, instanceId, 'PAUSE'); // resolves even though it's a 200 here
    const snap = await client.getInstance(stub.uri, instanceId);
    expect(snap.state).toBe('PAUSED');

    // PAUSED does not accept PAUSE again -> 409, tolerated (resolves without throwing)
    await expect(client.sendCommand(stub.uri, instanceId, 'PAUSE')).resolves.toBeUndefined();
    const snap2 = await client.getInstance(stub.uri, instanceId);
    expect(snap2.state).toBe('PAUSED'); // unchanged — the invalid command was rejected server-side
  });

  it('capabilities endpoint reflects configured per-action commands', async () => {
    stub = startStubActionServer(0);
    stub.control.setCapabilities('act-1', { supportedCommands: ['PAUSE', 'RESUME', 'ABORT', 'STOP'], opaque: false });
    const client = new ActionClient([new URL(stub.uri).origin]);

    const caps = await client.capabilities(stub.uri);
    expect(caps.byActionOid.get('act-1')).toEqual({ supportedCommands: ['PAUSE', 'RESUME', 'ABORT', 'STOP'], opaque: false });
  });

  it('deleteInstance removes the instance (subsequent getInstance -> ActionInstanceLost)', async () => {
    stub = startStubActionServer(0);
    const client = new ActionClient([new URL(stub.uri).origin]);
    const { instanceId } = await client.invoke(stub.uri, 'act-1', invokeBody);

    await client.deleteInstance(stub.uri, instanceId);
    await expect(client.getInstance(stub.uri, instanceId)).rejects.toBeInstanceOf(ActionInstanceLost);
  });
});

describe('ActionClient fetch timeouts (GATE follow-up item 2)', () => {
  // A bound gate polls getProperty once per cycle on the engine's single sequential worker,
  // so every call site must be bounded — one wedged action server must not stall the loop.
  it('every call site passes an AbortSignal', async () => {
    const seen: Array<AbortSignal | null | undefined> = [];
    const answer = (status: number, body: unknown) => async (_url: RequestInfo | URL, init?: RequestInit) => {
      seen.push(init?.signal);
      return jsonResponse(status, body);
    };
    const client = new ActionClient(['http://localhost:3002'], fetchMock);
    fetchMock.mockImplementationOnce(answer(201, { data: { instance_id: 'ai-1' } }));
    await client.invoke('http://localhost:3002', 'act-1', invokeBody);
    fetchMock.mockImplementationOnce(answer(200, { data: { status: 'RUNNING' } }));
    await client.getInstance('http://localhost:3002', 'ai-1');
    fetchMock.mockImplementationOnce(answer(200, {}));
    await client.sendCommand('http://localhost:3002', 'ai-1', 'PAUSE');
    fetchMock.mockImplementationOnce(answer(204, {}));
    await client.deleteInstance('http://localhost:3002', 'ai-1');
    fetchMock.mockImplementationOnce(answer(200, { data: { environments: [] } }));
    await client.capabilities('http://localhost:3002');
    fetchMock.mockImplementationOnce(answer(200, { data: { environment_oid: 'env-1', name: 'Temps', entries: [] } }));
    await client.getProperty('http://localhost:3002', 'Temps', 'env-1');
    expect(seen).toHaveLength(6);
    for (const s of seen) expect(s).toBeInstanceOf(AbortSignal);
  });

  it('a call that never resolves is rejected after timeoutMs with a TimeoutError', async () => {
    const hanging: FetchLike = (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    });
    const client = new ActionClient(['http://localhost:3002'], hanging, { timeoutMs: 20 });
    await expect(client.getProperty('http://localhost:3002', 'Temps', 'env-1')).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('deleteInstance swallows a timeout like any other network failure (best-effort)', async () => {
    const hanging: FetchLike = (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    });
    const client = new ActionClient(['http://localhost:3002'], hanging, { timeoutMs: 20 });
    await expect(client.deleteInstance('http://localhost:3002', 'ai-1')).resolves.toBeUndefined();
  });
});
