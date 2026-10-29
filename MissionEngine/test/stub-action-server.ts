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
// Test-only protocol stub: a minimal Hono action server implementing just enough of
// spec/docs/RESTProtocolSpec.md (TrajectoryRuntime) to exercise ActionClient + subscribeSse
// end-to-end over a real HTTP connection. Not a conformance reference — the state machine is
// deliberately collapsed to two live states (RUNNING, PAUSED) per task-14-brief.md's ruling:
// "state table per RESTProtocolSpec.md:291: RUNNING->PAUSE/HOLD/ABORT/STOP,
// PAUSED->RESUME/ABORT/STOP; 409 otherwise." Any other current state (IDLE, HELD, or a
// terminal state) rejects every command with 409.
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { streamSSE, type SSEStreamingApi } from 'hono/streaming';
import type { AddressInfo } from 'node:net';
import type { IncomingMessage } from 'node:http';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ActionCommand, ServerState } from '../src/actions/client.js';

interface StubInstance {
  actionOid: string;
  state: ServerState;
  previousState: ServerState | null;
  outputs: Array<{ name: string; value: string }>;
}

export interface StubCapability {
  supportedCommands: ActionCommand[];
  opaque?: boolean;
  /** Spec 2026-08-20 (loose matching): the NAME this action is advertised under. Defaults to the
   *  action oid, which is what every pre-loose-matching caller of `setCapabilities` implicitly
   *  wanted. A test exercising loose resolution sets it to the name its frozen recipe uses. */
  actionName?: string;
  /** Advertised input parameter names — loose matching requires the container's set to be a
   *  superset of what the invoke sends. Defaults to `[]`, which every engine fixture satisfies
   *  (none of them send input parameters to an ACTION PROXY step). */
  inputParameterNames?: string[];
}

/** The wire shape of GET /trajectory/v1/capabilities (mirrors ActionClient's own
 *  CapabilitiesWireResponse). A test that needs full control over the grouped payload —
 *  environment oids/names the stub could not otherwise invent, or actions whose oids differ from
 *  everything the workflow knows — passes one of these to `startStubActionServer`. */
export interface StubCapabilitiesPayload {
  data: {
    environments: Array<{
      environment_oid: string;
      environment_name: string;
      actions: Array<{
        action_oid: string;
        action_name: string;
        visibility: 'opaque' | 'observable';
        input_parameters: Array<{ name: string }>;
        /** Present on the real wire shape; ActionClient ignores it. Accepted here so a fixture
         *  can be transcribed from a real capabilities response without trimming. */
        output_parameters?: Array<{ name: string }>;
        supported_commands: ActionCommand[];
      }>;
    }>;
  };
}

export interface StubOptions {
  /** Serves this exact payload from GET /capabilities, instead of the one derived from
   *  `setCapabilities`. */
  capabilities?: StubCapabilitiesPayload;
  /** When set, POST /actions/:oid/invoke answers 404 for any oid outside this list — the way a
   *  real container rejects an action it does not have. Default (unset): every oid is invokable,
   *  which is what every pre-2026-08-20 test assumes. */
  invokableActionOids?: string[];
  /** Spec 2026-09-14 §6.1/§6.5: answer 404 PROPERTY_NOT_FOUND on GET /properties/:name/events
   *  even for a registered group, while REST-11 keeps serving values — the "stream unavailable,
   *  the cycle still evaluates" backstop. Default (unset): the stream is served. */
  propertyEventsUnavailable?: boolean;
  /** Spec 2026-09-14 §4.8 test seam: runs inside GET /trajectory/v1/properties/:name AFTER the
   *  value was read and BEFORE it is served, and the response carries the entries read before the
   *  hook ran — so a hook that rewrites the group models "the value changed the instant after this
   *  read was served". Only the gate-property-events race test uses it. */
  onPropertyRead?: (envOid: string, group: string) => void | Promise<void>;
  /** Data-safety spec 2026-10-21: every request waits this long before it is handled — a slow
   *  action server. Default (unset): no delay. */
  responseDelayMs?: number;
}

const ALL_COMMANDS: ActionCommand[] = ['PAUSE', 'RESUME', 'HOLD', 'UNHOLD', 'ABORT', 'STOP', 'CLEAR'];

/** The synthetic environment the stub reports every `setCapabilities`-registered action under.
 *  Deliberately NAMED for the `env-1`/`'env'` environment specification that the engine's test
 *  fixtures all use, so loose matching (now the system default) resolves against an unconfigured
 *  stub exactly as strict matching would — i.e. back onto the workflow's own oids. */
const STUB_ENV = { oid: 'env-1', name: 'env' };

/** Served when a test configured no capabilities at all: the `act-1`/`DoThing` action inside
 *  `STUB_ENV`, which is precisely the fixture identity test/action-execution.test.ts's ENV_SPECS
 *  declares. Keeps every OID-shaped existing test green under the loose default without any of
 *  them having to know loose matching exists. */
const DEFAULT_CAPABILITIES: StubCapabilitiesPayload = {
  data: {
    environments: [{
      environment_oid: STUB_ENV.oid,
      environment_name: STUB_ENV.name,
      actions: [{
        action_oid: 'act-1', action_name: 'DoThing', visibility: 'observable',
        input_parameters: [], supported_commands: ALL_COMMANDS,
      }],
    }],
  },
};

const COMMAND_TABLE: Partial<Record<ServerState, ActionCommand[]>> = {
  RUNNING: ['PAUSE', 'HOLD', 'ABORT', 'STOP'],
  PAUSED: ['RESUME', 'ABORT', 'STOP'],
};

const NEXT_STATE: Record<ActionCommand, ServerState> = {
  PAUSE: 'PAUSED',
  RESUME: 'RUNNING',
  HOLD: 'HELD',
  UNHOLD: 'RUNNING',
  ABORT: 'ABORTED',
  STOP: 'STOPPED',
  CLEAR: 'IDLE',
};

export interface StubControl {
  /** Drives a state transition directly (bypassing the command state machine) and broadcasts
   *  a state_change SSE event to current subscribers. When `outputs` is given, also stores it
   *  on the instance and broadcasts an `output` event. */
  advance(instanceId: string, state: ServerState, outputs?: Array<{ name: string; value: string }>): void;
  /** Configures the GET /capabilities response for one action oid. */
  setCapabilities(actionOid: string, cap: StubCapability): void;
  /** Data safety round 2: false makes GET /capabilities answer 503 { error: 'unavailable' } — an
   *  action server the engine cannot reach. True (the default) restores normal answers. */
  setCapabilitiesAvailable(available: boolean): void;
  /** Data safety round 3: how POST /instances/:id/command answers from now on. 200 (the default)
   *  restores normal handling; any other status answers with that status and an error body, and
   *  'drop' destroys the connection without an answer — a server that died mid-request. */
  setCommandResponse(status: number | 'drop'): void;
  /** Round 2 (spec 2026-10-23 goal 5): how GET /instances/:id answers from now on. 200 (the
   *  default) restores normal answers; any other status answers with that status and an error
   *  body, and 'drop' destroys the connection without an answer (a network error). */
  setInstanceResponse(status: number | 'drop'): void;
  /** Task 6 (GATE action-property bindings): registers the CURRENT entries for one
   *  environment-scoped property group, served by GET /trajectory/v1/properties/:name.
   *  Spec 2026-09-14 §6.1: ALSO publishes a REST-12 `property` event to that group's open
   *  streams when at least one entry value changed (`changed_entries` = the changed names; every
   *  name on the first registration) — the way Mission Autopilot's publishProperty does. */
  setEnvProperty(envOid: string, group: string, entries: Array<{ name: string; value: string }>): void;
  /** Spec 2026-09-14 §6: how many REST-12 streams are currently open on one group. */
  propertySubscribers(envOid: string, group: string): number;
  /** Spec 2026-09-14 §6.5: ends every open REST-12 stream on one group server-side — an
   *  Autopilot restart, as the engine sees it. Subscribers must reconnect on their own. */
  dropPropertyStreams(envOid: string, group: string): void;
}

export interface StubActionServer {
  uri: string;
  control: StubControl;
  /** Every invoke this server accepted, in order — the oid the engine actually dispatched to and
   *  the body it sent. Loose matching is only observable from the outside as "which oid got
   *  invoked", so this is the assertion surface for it. */
  invokes: Array<{ actionOid: string; body: unknown }>;
  close(): Promise<void>;
}

export function startStubActionServer(port: number, opts: StubOptions = {}): StubActionServer {
  const instances = new Map<string, StubInstance>();
  const capabilities = new Map<string, StubCapability>();
  let capabilitiesAvailable = true;
  let commandResponse: number | 'drop' = 200;
  let instanceResponse: number | 'drop' = 200;
  // Task 6: keyed `${envOid}:${group}` — GET /trajectory/v1/properties/:name.
  const envProperties = new Map<string, Array<{ name: string; value: string }>>();
  const invokes: Array<{ actionOid: string; body: unknown }> = [];
  const invokable = opts.invokableActionOids ? new Set(opts.invokableActionOids) : null;
  const subscribers = new Map<string, Set<SSEStreamingApi>>();
  // Spec 2026-09-14 §6.1: REST-12 streams, keyed `${envOid}:${group}` like envProperties.
  // `propertyDroppers` holds each open stream's "end this response" resolver so
  // dropPropertyStreams can close it from the server side.
  const propertyStreams = new Map<string, Set<SSEStreamingApi>>();
  const propertyDroppers = new Map<SSEStreamingApi, () => void>();
  let nextEventId = 1;
  let nextInstanceSeq = 1;

  function broadcast(instanceId: string, event: string, data: unknown): void {
    const set = subscribers.get(instanceId);
    if (!set || set.size === 0) return;
    const id = String(nextEventId++);
    for (const stream of set) {
      void stream.writeSSE({ event, data: JSON.stringify(data), id });
    }
  }

  function publishProperty(envOid: string, group: string, entries: Array<{ name: string; value: string }>, changed: string[]): void {
    const set = propertyStreams.get(`${envOid}:${group}`);
    if (!set || set.size === 0) return;
    const id = String(nextEventId++);
    const data = {
      environment_oid: envOid, property_name: group, entries, changed_entries: changed,
      source: 'console', timestamp: new Date().toISOString(),
    };
    for (const stream of set) {
      void stream.writeSSE({ event: 'property', data: JSON.stringify(data), id });
    }
  }

  function applyState(instanceId: string, inst: StubInstance, next: ServerState): void {
    inst.previousState = inst.state;
    inst.state = next;
    broadcast(instanceId, 'state_change', {
      instance_id: instanceId,
      state: next,
      previous_state: inst.previousState,
      timestamp: new Date().toISOString(),
    });
  }

  const app = new Hono();

  if (opts.responseDelayMs) {
    const delayMs = opts.responseDelayMs;
    app.use('*', async (_c, next) => {
      await new Promise((r) => setTimeout(r, delayMs));
      await next();
    });
  }

  app.post('/trajectory/v1/actions/:actionOid/invoke', async (c) => {
    const actionOid = c.req.param('actionOid');
    if (invokable && !invokable.has(actionOid)) {
      return c.json({ error: { code: 'ACTION_NOT_FOUND', message: `No action "${actionOid}"` } }, 404);
    }
    const body = await c.req.json().catch(() => ({}));
    invokes.push({ actionOid, body });
    const instanceId = `stub-${actionOid}-${nextInstanceSeq++}`;
    instances.set(instanceId, { actionOid, state: 'IDLE', previousState: null, outputs: [] });
    return c.json({ data: { instance_id: instanceId } }, 201);
  });

  app.get('/trajectory/v1/instances/:id', (c) => {
    if (instanceResponse === 'drop') {
      (c.env as { incoming: IncomingMessage }).incoming.socket.destroy();
      return new Promise<Response>(() => {}); // never answered — the socket is gone
    }
    if (instanceResponse !== 200) {
      return c.json({ error: { code: 'STUB_INSTANCE_RESPONSE', message: `stub answered ${instanceResponse}` } }, instanceResponse as ContentfulStatusCode);
    }
    const inst = instances.get(c.req.param('id'));
    if (!inst) return c.json({ error: { code: 'INSTANCE_NOT_FOUND' } }, 404);
    return c.json({ data: { state: inst.state, outputs: inst.outputs } }, 200);
  });

  app.post('/trajectory/v1/instances/:id/command', async (c) => {
    if (commandResponse === 'drop') {
      (c.env as { incoming: IncomingMessage }).incoming.socket.destroy();
      return new Promise<Response>(() => {}); // never answered — the socket is gone
    }
    if (commandResponse !== 200) {
      const code = commandResponse === 404 ? 'INSTANCE_NOT_FOUND' : 'STUB_COMMAND_RESPONSE';
      return c.json({ error: { code, message: `stub answered ${commandResponse}` } }, commandResponse as ContentfulStatusCode);
    }
    const id = c.req.param('id');
    const inst = instances.get(id);
    if (!inst) return c.json({ error: { code: 'INSTANCE_NOT_FOUND' } }, 404);

    const body = (await c.req.json().catch(() => ({}))) as { command?: ActionCommand };
    const command = body.command;
    const allowed = command ? (COMMAND_TABLE[inst.state] ?? []) : [];
    if (!command || !allowed.includes(command)) {
      return c.json(
        { error: { code: 'INVALID_STATE_TRANSITION', message: `Cannot ${String(command)} from ${inst.state}` } },
        409,
      );
    }
    applyState(id, inst, NEXT_STATE[command]);
    return c.json({ data: { accepted: true, new_state: inst.state } }, 200);
  });

  app.delete('/trajectory/v1/instances/:id', (c) => {
    const id = c.req.param('id');
    const existed = instances.delete(id);
    subscribers.delete(id);
    return c.json({ data: { deleted: existed } }, existed ? 200 : 404);
  });

  app.get('/trajectory/v1/capabilities', (c) => {
    // Task 3 (action-matching-mode): the real server groups actions under environments — this
    // stub has no environment model of its own, so every `setCapabilities`-configured action is
    // reported under one synthetic environment (STUB_ENV). Task 5 adds the two escape hatches
    // loose matching needs: an explicit whole-payload override (opts.capabilities) for tests that
    // must control environment/action identity outright, and DEFAULT_CAPABILITIES for the
    // overwhelmingly common case of a test that configured nothing at all.
    if (!capabilitiesAvailable) return c.json({ error: 'unavailable' }, 503);
    if (opts.capabilities) return c.json(opts.capabilities, 200);
    if (capabilities.size === 0) return c.json(DEFAULT_CAPABILITIES, 200);
    const actions = [...capabilities.entries()].map(([action_oid, cap]) => ({
      action_oid,
      action_name: cap.actionName ?? action_oid,
      visibility: cap.opaque ? 'opaque' : 'observable',
      input_parameters: (cap.inputParameterNames ?? []).map((name) => ({ name })),
      supported_commands: cap.supportedCommands,
    }));
    return c.json({
      data: { environments: [{ environment_oid: STUB_ENV.oid, environment_name: STUB_ENV.name, actions }] },
    }, 200);
  });

  app.get('/trajectory/v1/properties/:name', async (c) => {
    const name = c.req.param('name');
    const envOid = c.req.query('environment_oid');
    const hit = envProperties.get(`${envOid}:${name}`);
    if (!hit) {
      return c.json({ error: { code: 'PROPERTY_NOT_FOUND', message: `Property '${name}' not found`, details: {} } }, 404);
    }
    // `hit` was captured above; setEnvProperty replaces the map entry with a NEW array, so a hook
    // that rewrites the group leaves this response carrying the pre-change value (spec §4.8 seam).
    if (opts.onPropertyRead) await opts.onPropertyRead(envOid ?? '', name);
    return c.json({ data: { environment_oid: envOid, environment_name: STUB_ENV.name, name, entries: hit }, meta: {} });
  });

  // Spec 2026-09-14 §6.1 — REST-12: GET /trajectory/v1/properties/:name/events. 404 for an
  // unregistered group (the real server's PROPERTY_NOT_FOUND), or for every group when
  // opts.propertyEventsUnavailable is set. The stream stays open until the client aborts or
  // dropPropertyStreams ends it; setEnvProperty writes `property` events into it. Hono's
  // streamSSE closes the response as soon as this callback resolves, so "end it server-side"
  // is simply "resolve the wait".
  app.get('/trajectory/v1/properties/:name/events', (c) => {
    const name = c.req.param('name');
    const envOid = c.req.query('environment_oid');
    const key = `${envOid}:${name}`;
    if (opts.propertyEventsUnavailable || !envProperties.has(key)) {
      return c.json({ error: { code: 'PROPERTY_NOT_FOUND', message: `Property '${name}' not found`, details: {} } }, 404);
    }
    return streamSSE(c, async (stream) => {
      const set = propertyStreams.get(key) ?? new Set<SSEStreamingApi>();
      propertyStreams.set(key, set);
      set.add(stream);
      await new Promise<void>((resolve) => {
        propertyDroppers.set(stream, resolve);
        stream.onAbort(() => resolve());
        // Belt and braces: @hono/node-server aborts the request signal when the client's socket
        // closes, which is the path a closed engine-side stream takes.
        c.req.raw.signal.addEventListener('abort', () => resolve(), { once: true });
      });
      set.delete(stream);
      propertyDroppers.delete(stream);
    });
  });

  app.get('/trajectory/v1/instances/:id/events', (c) => {
    const id = c.req.param('id');
    if (!instances.has(id)) return c.json({ error: { code: 'INSTANCE_NOT_FOUND' } }, 404);

    return streamSSE(c, async (stream) => {
      const set = subscribers.get(id) ?? new Set<SSEStreamingApi>();
      subscribers.set(id, set);
      set.add(stream);
      await new Promise<void>((resolve) => stream.onAbort(() => resolve()));
      set.delete(stream);
    });
  });

  // No `hostname` option: @hono/node-server forwards it straight to node:http's
  // `listen(port, hostname, cb)`, and passing an explicit hostname (even '127.0.0.1') pushes
  // Node onto its async DNS-lookup-then-bind path, so `server.address()` is still null the
  // instant `serve()` returns. Omitting hostname takes the synchronous bind path (verified: an
  // immediate `server.address()` after `listen(port)` already reflects the assigned port) —
  // required here since `startStubActionServer` returns synchronously, not a Promise. The
  // resulting dual-stack bind (`::`) still accepts a plain 127.0.0.1 connection on this host.
  const server = serve({ fetch: app.fetch, port });
  const address = server.address() as AddressInfo;
  const uri = `http://127.0.0.1:${address.port}`;

  const control: StubControl = {
    advance(instanceId, state, outputs) {
      const inst = instances.get(instanceId);
      if (!inst) throw new Error(`stub-action-server: unknown instance "${instanceId}"`);
      applyState(instanceId, inst, state);
      if (outputs) {
        inst.outputs = outputs;
        broadcast(instanceId, 'output', {
          instance_id: instanceId,
          outputs,
          timestamp: new Date().toISOString(),
        });
      }
    },
    setCapabilities(actionOid, cap) {
      capabilities.set(actionOid, cap);
    },
    setCapabilitiesAvailable(available) {
      capabilitiesAvailable = available;
    },
    setCommandResponse(status) {
      commandResponse = status;
    },
    setInstanceResponse(status) {
      instanceResponse = status;
    },
    setEnvProperty(envOid, group, entries) {
      const key = `${envOid}:${group}`;
      const before = envProperties.get(key);
      envProperties.set(key, entries);
      const changed = before
        ? entries.filter((e) => before.find((b) => b.name === e.name)?.value !== e.value).map((e) => e.name)
        : entries.map((e) => e.name);
      if (changed.length > 0) publishProperty(envOid, group, entries, changed);
    },
    propertySubscribers(envOid, group) {
      return propertyStreams.get(`${envOid}:${group}`)?.size ?? 0;
    },
    dropPropertyStreams(envOid, group) {
      const set = propertyStreams.get(`${envOid}:${group}`);
      if (!set) return;
      for (const stream of [...set]) propertyDroppers.get(stream)?.();
    },
  };

  return {
    uri,
    control,
    invokes,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
