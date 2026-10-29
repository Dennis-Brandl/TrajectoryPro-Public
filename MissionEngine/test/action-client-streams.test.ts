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
// Spec 2026-09-14 (GATE bound-property events) §4.6: the generalized SSE parser, the two
// ActionClient stream methods, and the test stub's REST-12 route. Mock-fetch tests follow
// test/action-client.test.ts's sseStreamResponse pattern; the stub tests go over real HTTP.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  subscribeEventStream, subscribeSse, toPropertyEvent,
  type ActionEvent, type PropertyStreamEvent,
} from '../src/actions/sse.js';
import { ActionClient, ActionServerNotAllowed } from '../src/actions/client.js';
import { startStubActionServer, type StubActionServer } from './stub-action-server.js';

function sseStreamResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status });
}

/** One REST-12 event exactly as Mission Autopilot's sse-utils.ts formats publishProperty's payload. */
const PROPERTY_BLOCK =
  'event: property\nid: 7\ndata: {"environment_oid":"env-1","property_name":"Sensor","entries":[{"name":"Value","value":"150"}],"changed_entries":["Value"],"source":"console","timestamp":"2026-09-14T00:00:00Z"}\n\n';

describe('toPropertyEvent (§4.6)', () => {
  it('maps a property block to a PropertyEvent carrying the wire field names', () => {
    const evt = toPropertyEvent({
      event: 'property', id: '7',
      data: '{"environment_oid":"env-1","property_name":"Sensor","entries":[{"name":"Value","value":"150"}],"changed_entries":["Value"],"source":"console","timestamp":"t1"}',
    });
    expect(evt).toEqual({
      type: 'property', environment_oid: 'env-1', property_name: 'Sensor',
      changed_entries: ['Value'], entries: [{ name: 'Value', value: '150' }], ts: 't1', eventId: 7,
    });
  });

  it('maps a heartbeat, and ignores any other event name or malformed JSON', () => {
    expect(toPropertyEvent({ event: 'heartbeat', data: '{"timestamp":"t2"}' })).toEqual({ type: 'heartbeat', ts: 't2' });
    expect(toPropertyEvent({ event: 'state_change', data: '{"state":"RUNNING"}' })).toBeNull();
    expect(toPropertyEvent({ event: 'property', data: 'not json' })).toBeNull();
  });

  it('tolerates a property payload with missing or odd fields', () => {
    expect(toPropertyEvent({ event: 'property', data: '{}' })).toEqual({
      type: 'property', environment_oid: '', property_name: '', changed_entries: [], entries: [], ts: '', eventId: NaN,
    });
  });
});

describe('subscribeEventStream (§4.6)', () => {
  it('fires onOpen on a 200, dispatches mapped events, then onEnd("stream ended") when the body closes', async () => {
    const received: PropertyStreamEvent[] = [];
    const opened = vi.fn();
    const ended = vi.fn();
    // Split mid-block to prove buffering across reads still works in the generic parser.
    const mockFetch = vi.fn().mockResolvedValue(sseStreamResponse([PROPERTY_BLOCK.slice(0, 40), PROPERTY_BLOCK.slice(40)]));

    const handle = subscribeEventStream(
      'http://x/trajectory/v1/properties/Sensor/events?environment_oid=env-1', toPropertyEvent,
      { onEvent: (e) => received.push(e), onOpen: opened, onEnd: ended }, mockFetch,
    );
    await vi.waitFor(() => expect(ended).toHaveBeenCalledWith('stream ended'));

    expect(opened).toHaveBeenCalledTimes(1);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ type: 'property', property_name: 'Sensor', eventId: 7 });
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://x/trajectory/v1/properties/Sensor/events?environment_oid=env-1');
    expect((init.headers as Record<string, string>).Accept).toBe('text/event-stream');
    handle.close();
  });

  it('a non-200 response ends with the status and body text and never opens', async () => {
    const opened = vi.fn();
    const ended = vi.fn();
    const mockFetch = vi.fn().mockResolvedValue(new Response('{"error":{"code":"PROPERTY_NOT_FOUND"}}', { status: 404 }));

    subscribeEventStream('http://x/events', toPropertyEvent, { onEvent: () => {}, onOpen: opened, onEnd: ended }, mockFetch);
    await vi.waitFor(() => expect(ended).toHaveBeenCalledTimes(1));

    expect(ended.mock.calls[0]![0]).toBe('stream open failed (404): {"error":{"code":"PROPERTY_NOT_FOUND"}}');
    expect(opened).not.toHaveBeenCalled();
  });

  it('a rejected fetch ends with "connect failed"', async () => {
    const ended = vi.fn();
    subscribeEventStream('http://x/events', toPropertyEvent, { onEvent: () => {}, onEnd: ended },
      vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await vi.waitFor(() => expect(ended).toHaveBeenCalledWith('connect failed: ECONNREFUSED'));
  });

  it('a fetch that resolves to nothing (a bare vi.fn() stub) ends quietly instead of throwing', async () => {
    const ended = vi.fn();
    subscribeEventStream('http://x/events', toPropertyEvent, { onEvent: () => {}, onEnd: ended }, vi.fn() as any);
    await vi.waitFor(() => expect(ended).toHaveBeenCalledWith('stream open failed (no response): '));
  });

  it('close() suppresses onEnd and any event already in flight', async () => {
    const ended = vi.fn();
    const received: PropertyStreamEvent[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const encoder = new TextEncoder();
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        pulls++;
        if (pulls === 1) { controller.enqueue(encoder.encode('event: heartbeat\ndata: {"timestamp":"t1"}\n\n')); return; }
        await gate;
        controller.enqueue(encoder.encode(PROPERTY_BLOCK));
        controller.close();
      },
    });
    const handle = subscribeEventStream('http://x/events', toPropertyEvent,
      { onEvent: (e) => received.push(e), onEnd: ended }, vi.fn().mockResolvedValue(new Response(stream)));
    await vi.waitFor(() => expect(received).toHaveLength(1));

    handle.close();
    release();
    await new Promise((r) => setTimeout(r, 20));

    expect(received).toHaveLength(1);
    expect(ended).not.toHaveBeenCalled();
  });

  it('subscribeSse still parses the instance stream with the ActionEvent mapper and the same URL', async () => {
    const received: ActionEvent[] = [];
    const mockFetch = vi.fn().mockResolvedValue(sseStreamResponse([
      'id: 1\nevent: state_change\ndata: {"state":"RUNNING","previous_state":"IDLE","timestamp":"t"}\n\n',
    ]));
    const handle = subscribeSse('http://x', 'ai-1', (e) => received.push(e), mockFetch);
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toMatchObject({ kind: 'state_change', state: 'RUNNING', eventId: 1 });
    expect((mockFetch.mock.calls[0] as [string])[0]).toBe('http://x/trajectory/v1/instances/ai-1/events');
    handle.close();
  });

  it('a throwing onOpen ends the stream once with "callback error" and never dispatches events', async () => {
    const ended = vi.fn();
    const received: PropertyStreamEvent[] = [];
    const mockFetch = vi.fn().mockResolvedValue(sseStreamResponse([PROPERTY_BLOCK]));
    subscribeEventStream('http://x/events', toPropertyEvent, {
      onEvent: (e) => received.push(e), onOpen: () => { throw new Error('open boom'); }, onEnd: ended,
    }, mockFetch);
    await vi.waitFor(() => expect(ended).toHaveBeenCalledTimes(1));
    expect(ended).toHaveBeenCalledWith('callback error: open boom');
    await new Promise((r) => setTimeout(r, 20));
    expect(received).toHaveLength(0);
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it('a throwing onEnd is logged and does not become an unhandled rejection', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    subscribeEventStream('http://x/events', toPropertyEvent, {
      onEvent: () => {}, onEnd: () => { throw new Error('end boom'); },
    }, vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledTimes(1));
    expect(String(errorSpy.mock.calls[0]![0])).toContain('end boom');
    errorSpy.mockRestore();
  });
});

describe('ActionClient stream methods (§4.6)', () => {
  it('subscribePropertyEvents opens the REST-12 URL through the allowlist with NO timeout signal', async () => {
    const received: PropertyStreamEvent[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        await gate;
        controller.enqueue(encoder.encode(PROPERTY_BLOCK));
        controller.close();
      },
    });
    const mockFetch = vi.fn().mockResolvedValue(new Response(stream));
    // A 20 ms bound: fetchBounded's AbortSignal.timeout would have aborted this stream long
    // before the event below is released — the stream must be opened with the raw fetchImpl.
    const client = new ActionClient(['http://localhost:3002'], mockFetch, { timeoutMs: 20 });

    const handle = await client.subscribePropertyEvents('http://localhost:3002', 'Sensor', 'env-1', {
      onEvent: (e) => received.push(e),
    });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3002/trajectory/v1/properties/Sensor/events?environment_oid=env-1');
    expect((init.headers as Record<string, string>).Accept).toBe('text/event-stream');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    await new Promise((r) => setTimeout(r, 100)); // well past the 20 ms bound
    expect(init.signal!.aborted).toBe(false);

    release();
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toMatchObject({ type: 'property', property_name: 'Sensor' });

    handle.close();
    expect(init.signal!.aborted).toBe(true); // close() aborts the very signal the fetch got
  });

  it('subscribePropertyEvents rejects with ActionServerNotAllowed before any fetch when the origin is not trusted', async () => {
    const mockFetch = vi.fn();
    const client = new ActionClient(['http://other:1'], mockFetch);
    await expect(client.subscribePropertyEvents('http://localhost:3002', 'Sensor', 'env-1', { onEvent: () => {} }))
      .rejects.toBeInstanceOf(ActionServerNotAllowed);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('subscribePropertyEvents encodes the group and environment oid in the URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue(sseStreamResponse([]));
    const client = new ActionClient(['http://localhost:3002'], mockFetch);
    const handle = await client.subscribePropertyEvents('http://localhost:3002', 'Tank Level', 'env/1', { onEvent: () => {} });
    expect((mockFetch.mock.calls[0] as [string])[0])
      .toBe('http://localhost:3002/trajectory/v1/properties/Tank%20Level/events?environment_oid=env%2F1');
    handle.close();
  });

  it('subscribeInstanceEvents gates the instance stream the same way and parses ActionEvents', async () => {
    const received: ActionEvent[] = [];
    const mockFetch = vi.fn().mockResolvedValue(sseStreamResponse([
      'id: 3\nevent: state_change\ndata: {"state":"COMPLETED","previous_state":"RUNNING","timestamp":"t"}\n\n',
    ]));
    const client = new ActionClient(['http://localhost:3002'], mockFetch);

    const handle = await client.subscribeInstanceEvents('http://localhost:3002', 'ai-9', (e) => received.push(e));
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toMatchObject({ kind: 'state_change', state: 'COMPLETED', eventId: 3 });
    expect((mockFetch.mock.calls[0] as [string])[0]).toBe('http://localhost:3002/trajectory/v1/instances/ai-9/events');
    handle.close();

    const denied = new ActionClient([], vi.fn());
    await expect(denied.subscribeInstanceEvents('http://localhost:3002', 'ai-9', () => {}))
      .rejects.toBeInstanceOf(ActionServerNotAllowed);
  });
});

describe('stub action server — REST-12 property events (§6.1)', () => {
  let stub: StubActionServer;
  afterEach(async () => { if (stub) await stub.close(); });

  it('setEnvProperty publishes a property event to an open stream; an unchanged value publishes nothing', async () => {
    stub = startStubActionServer(0);
    stub.control.setEnvProperty('env-1', 'Sensor', [{ name: 'Value', value: '50' }]);
    const client = new ActionClient([new URL(stub.uri).origin]);
    const received: PropertyStreamEvent[] = [];
    const opened = vi.fn();

    const handle = await client.subscribePropertyEvents(stub.uri, 'Sensor', 'env-1', { onEvent: (e) => received.push(e), onOpen: opened });
    await vi.waitFor(() => expect(stub.control.propertySubscribers('env-1', 'Sensor')).toBe(1));
    await vi.waitFor(() => expect(opened).toHaveBeenCalledTimes(1));

    stub.control.setEnvProperty('env-1', 'Sensor', [{ name: 'Value', value: '50' }]);  // no change: silent
    stub.control.setEnvProperty('env-1', 'Sensor', [{ name: 'Value', value: '150' }]);
    await vi.waitFor(() => expect(received.filter((e) => e.type === 'property')).toHaveLength(1), { timeout: 2000 });
    expect(received.find((e) => e.type === 'property')).toMatchObject({
      type: 'property', environment_oid: 'env-1', property_name: 'Sensor',
      changed_entries: ['Value'], entries: [{ name: 'Value', value: '150' }],
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(received.filter((e) => e.type === 'property')).toHaveLength(1);

    handle.close();
    await vi.waitFor(() => expect(stub.control.propertySubscribers('env-1', 'Sensor')).toBe(0));
  });

  it('an unregistered group 404s the stream', async () => {
    stub = startStubActionServer(0);
    const ended = vi.fn();
    await new ActionClient([new URL(stub.uri).origin])
      .subscribePropertyEvents(stub.uri, 'Nope', 'env-1', { onEvent: () => {}, onEnd: ended });
    await vi.waitFor(() => expect(ended).toHaveBeenCalledTimes(1));
    expect(ended.mock.calls[0]![0]).toContain('404');
    expect(ended.mock.calls[0]![0]).toContain('PROPERTY_NOT_FOUND');
  });

  it('propertyEventsUnavailable 404s every stream while REST-11 still answers', async () => {
    stub = startStubActionServer(0, { propertyEventsUnavailable: true });
    stub.control.setEnvProperty('env-1', 'Sensor', [{ name: 'Value', value: '50' }]);
    const client = new ActionClient([new URL(stub.uri).origin]);
    const ended = vi.fn();

    await client.subscribePropertyEvents(stub.uri, 'Sensor', 'env-1', { onEvent: () => {}, onEnd: ended });
    await vi.waitFor(() => expect(ended).toHaveBeenCalledTimes(1));
    expect(ended.mock.calls[0]![0]).toContain('404');
    expect((await client.getProperty(stub.uri, 'Sensor', 'env-1')).entries).toEqual([{ name: 'Value', value: '50' }]);
  });

  it('dropPropertyStreams ends the response server-side: the client sees "stream ended"', async () => {
    stub = startStubActionServer(0);
    stub.control.setEnvProperty('env-1', 'Sensor', [{ name: 'Value', value: '50' }]);
    const client = new ActionClient([new URL(stub.uri).origin]);
    const ended = vi.fn();

    await client.subscribePropertyEvents(stub.uri, 'Sensor', 'env-1', { onEvent: () => {}, onEnd: ended });
    await vi.waitFor(() => expect(stub.control.propertySubscribers('env-1', 'Sensor')).toBe(1));

    stub.control.dropPropertyStreams('env-1', 'Sensor');
    await vi.waitFor(() => expect(ended).toHaveBeenCalledWith('stream ended'), { timeout: 2000 });
    expect(stub.control.propertySubscribers('env-1', 'Sensor')).toBe(0);
  });
});
