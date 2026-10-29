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
// Hand-rolled SSE parser over a fetch body stream (no EventSource — the reference repo's
// SseObserver.ts uses the browser's EventSource, which isn't available in this Node backend).
// Event kinds and payload field names are transcribed from
// engines/web-ui/src/actionProxy/types.ts (ActionEvent* interfaces) and SseObserver.ts's
// per-event JSON shapes, which in turn match RESTProtocolSpec.md §2.6.
//
// Per task-14-brief.md: no reconnect, no Last-Event-ID resume. On stream error or close this
// module just stops — polling (built in Task 15) is the correctness backstop, this is purely
// a low-latency fast path.
//
// Spec 2026-09-14 §4.6 (GATE bound-property events): the parser is generalized into
// `subscribeEventStream(url, mapEvent, callbacks, fetchImpl)` so the REST-12 property stream
// shares one parser with the instance stream. Reconnect stays OUTSIDE this module: the property
// registry (core/property-watch.ts) reconnects from the `onEnd` callback with its own backoff,
// while the instance stream (`subscribeSse`, used by monitor.ts through ActionClient) passes no
// `onEnd` and keeps its documented no-reconnect posture.
import type { FetchLike, ServerState } from './client.js';

export interface ActionEventStateChange {
  kind: 'state_change';
  state: ServerState;
  previous_state: ServerState | null;
  ts: string;
  eventId: number;
}

export interface ActionEventOutput {
  kind: 'output';
  outputs: Array<{ name: string; value: string }>;
  ts: string;
  eventId: number;
}

export interface ActionEventLog {
  kind: 'log';
  stream: 'stdout' | 'stderr';
  message: string;
  ts: string;
  eventId: number;
}

/** No eventId — matches the reference SseObserver, which doesn't thread lastEventId through
 *  for heartbeats (they carry no state and are never worth resuming from). */
export interface ActionEventHeartbeat {
  kind: 'heartbeat';
  ts: string;
}

export type ActionEvent = ActionEventStateChange | ActionEventOutput | ActionEventLog | ActionEventHeartbeat;

/** Spec 2026-09-14 §4.6: one REST-12 `property` event — Mission Autopilot's
 *  `SseManager.publishProperty` payload (`environment_oid`, `property_name`, `entries`,
 *  `changed_entries`, `source`, `timestamp`), field names kept as on the wire. The engine only
 *  ever uses it as a TRIGGER: `entries` is parsed for completeness and never read (§1, §3). */
export interface PropertyEvent {
  type: 'property';
  environment_oid: string;
  property_name: string;
  changed_entries: string[];
  entries: Array<{ name: string; value: string }>;
  ts: string;
  eventId: number;
}

export interface PropertyHeartbeat {
  type: 'heartbeat';
  ts: string;
}

export type PropertyStreamEvent = PropertyEvent | PropertyHeartbeat;

export interface SseHandle {
  close(): void;
}

export interface ParsedSseBlock {
  event: string;
  data: string;
  id?: string;
}

/** Spec 2026-09-14 §4.6: what a stream consumer can observe besides events. `onOpen` fires once,
 *  when the response arrived with status 200 and a readable body. `onEnd` fires at most once,
 *  when the stream is over for any reason other than `close()` — the fetch rejected, a non-200
 *  status (the reason carries the status and body text), a callback threw, a mid-read error, or
 *  a clean end-of-stream — and never after `close()`. Reason strings: `connect failed: <message>`,
 *  `stream open failed (<status>): <body>`, `stream open failed (no response): `, `stream open failed: empty body`,
 *  `callback error: <message>`, `stream error: <message>`, `stream ended`. Both callbacks are optional;
 *  the instance stream sets neither. */
export interface EventStreamCallbacks<E> {
  onEvent: (e: E) => void;
  onOpen?: () => void;
  onEnd?: (reason: string) => void;
}

/** Parses one blank-line-delimited SSE block into its event/data/id fields. Multiple `data:`
 *  lines are joined with `\n` per the SSE spec; unrecognized field lines are ignored. Returns
 *  null when the block has no event name or no data (nothing to dispatch). */
export function parseSseBlock(block: string): ParsedSseBlock | null {
  let event: string | undefined;
  let id: string | undefined;
  const dataLines: string[] = [];

  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    else if (line.startsWith('id:')) id = line.slice(3).trim();
  }

  if (!event || dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n'), id };
}

export function toActionEvent(block: ParsedSseBlock): ActionEvent | null {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(block.data) as Record<string, unknown>;
  } catch {
    return null;
  }
  const eventId = block.id !== undefined ? Number(block.id) : NaN;

  switch (block.event) {
    case 'state_change':
      return {
        kind: 'state_change',
        state: payload.state as ServerState,
        previous_state: (payload.previous_state as ServerState | null | undefined) ?? null,
        ts: payload.timestamp as string,
        eventId,
      };
    case 'output':
      return {
        kind: 'output',
        outputs: (payload.outputs as Array<{ name: string; value: string }> | undefined) ?? [],
        ts: payload.timestamp as string,
        eventId,
      };
    case 'log':
      return {
        kind: 'log',
        stream: payload.stream as 'stdout' | 'stderr',
        message: payload.message as string,
        ts: payload.timestamp as string,
        eventId,
      };
    case 'heartbeat':
      return { kind: 'heartbeat', ts: payload.timestamp as string };
    default:
      // Other named events in the raw protocol (progress, hold_request, error) are outside
      // Task 14's four dispatched kinds — ignored here, not an error.
      return null;
  }
}

/** Spec 2026-09-14 §4.6: the REST-12 mapper. Tolerant by design — a malformed payload is
 *  dropped (null), a partial one is filled with empty values — because the engine never acts on
 *  the payload, only on the event's arrival. */
export function toPropertyEvent(block: ParsedSseBlock): PropertyStreamEvent | null {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(block.data) as Record<string, unknown>;
  } catch {
    return null;
  }
  switch (block.event) {
    case 'property': {
      const changed = Array.isArray(payload.changed_entries) ? (payload.changed_entries as unknown[]).map(String) : [];
      const entries = Array.isArray(payload.entries)
        ? (payload.entries as Array<{ name?: unknown; value?: unknown } | null>).map((e) => ({
          name: String(e?.name ?? ''), value: String(e?.value ?? ''),
        }))
        : [];
      return {
        type: 'property',
        environment_oid: String(payload.environment_oid ?? ''),
        property_name: String(payload.property_name ?? ''),
        changed_entries: changed,
        entries,
        ts: String(payload.timestamp ?? ''),
        eventId: block.id !== undefined ? Number(block.id) : NaN,
      };
    }
    case 'heartbeat':
      return { type: 'heartbeat', ts: String(payload.timestamp ?? '') };
    default:
      return null;
  }
}

/**
 * Subscribes to one SSE endpoint and dispatches every block `mapEvent` accepts to
 * `callbacks.onEvent`. Returns a handle whose `close()` aborts the underlying fetch and stops
 * further dispatch — including an event whose bytes were already in flight when close() was
 * called — and suppresses `onEnd`.
 *
 * No reconnect logic of its own: whatever ends the stream is reported once through `onEnd`
 * (when given) and this simply stops. If `onOpen` throws, the exception is caught, reported via
 * `onEnd` with reason `callback error: <message>`, and the stream stops; a throwing `onEnd` is
 * logged with `console.error` (`[mission-engine] event stream onEnd callback threw …`) and the
 * stream stops — `onEnd` is never re-entered.
 * Who reconnects, and how, is the caller's decision.
 */
export function subscribeEventStream<E>(
  url: string,
  mapEvent: (block: ParsedSseBlock) => E | null,
  callbacks: EventStreamCallbacks<E>,
  fetchImpl: FetchLike = fetch,
  extraHeaders: Record<string, string> = {},
): SseHandle {
  const controller = new AbortController();
  let stopped = false;
  const end = (reason: string): void => {
    if (stopped) return;
    try {
      callbacks.onEnd?.(reason);
    } catch (err) {
      console.error(`[mission-engine] event stream onEnd callback threw for ${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  void (async () => {
    let resp: Response | undefined;
    try {
      resp = await fetchImpl(url, {
        headers: { Accept: 'text/event-stream', ...extraHeaders },
        signal: controller.signal,
      });
    } catch (err) {
      end(`connect failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    if (stopped) return;
    if (!resp || resp.status !== 200) {
      // Bounded to 200 characters: this lands in a log line, not a user-facing message.
      const body = resp ? (await resp.text().catch(() => '')).slice(0, 200) : '';
      end(`stream open failed (${resp ? resp.status : 'no response'}): ${body}`);
      return;
    }
    if (!resp.body) { end('stream open failed: empty body'); return; }
    try {
      callbacks.onOpen?.();
    } catch (err) {
      end(`callback error: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      const reader = resp.body.getReader();
      while (!stopped) {
        const { value, done } = await reader.read();
        if (stopped || done) break;

        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const parsed = parseSseBlock(block);
          if (!parsed) continue;
          const evt = mapEvent(parsed);
          if (evt !== null && !stopped) callbacks.onEvent(evt);
        }
      }
    } catch (err) {
      end(`stream error: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    end('stream ended');
  })();

  return {
    close(): void {
      stopped = true;
      controller.abort();
    },
  };
}

/**
 * The action-instance event stream (RESTProtocolSpec.md §2.6) — the pre-2026-09-14 entry point,
 * kept as a thin wrapper over subscribeEventStream with the ActionEvent mapper and no
 * `onOpen`/`onEnd`, so its no-reconnect posture is unchanged: if the fetch rejects, the read loop
 * throws, or the stream ends, this simply stops. Polling via ActionClient.getInstance is the
 * correctness backstop; this is a latency optimization, not the source of truth.
 */
export function subscribeSse(
  serverUri: string,
  instanceId: string,
  onEvent: (e: ActionEvent) => void,
  fetchImpl: FetchLike = fetch,
  extraHeaders: Record<string, string> = {},
): SseHandle {
  return subscribeEventStream(
    `${serverUri}/trajectory/v1/instances/${encodeURIComponent(instanceId)}/events`,
    toActionEvent, { onEvent }, fetchImpl, extraHeaders,
  );
}
