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

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { loadCaller, RemoteError } from 'mission-control-db/src/runtime/remote-control/index';
import { ACTIONS, BROKER_ENV, findAction } from './catalog.js';
import { brokerAuth } from './auth.js';
import { execute } from './execute.js';
import { deleteInstance, findByActivation, finishInstance, getInstance, insertInstance, type Db } from './store.js';
import type { EventHub } from './events.js';
import type { Param } from './wire.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TERMINAL = new Set(['COMPLETED', 'ABORTED']);

type InvokeBody = { workflow_instance_id: string; step_instance_id: string; step_oid: string; input_parameters: Param[] };

function parseInvoke(raw: unknown): InvokeBody | null {
  const b = raw as Partial<InvokeBody> | null;
  if (!b || typeof b.workflow_instance_id !== 'string' || !UUID_RE.test(b.workflow_instance_id)
      || typeof b.step_instance_id !== 'string' || !UUID_RE.test(b.step_instance_id)
      || typeof b.step_oid !== 'string' || !Array.isArray(b.input_parameters)) return null;
  const params: Param[] = [];
  for (const p of b.input_parameters) {
    if (!p || typeof p.name !== 'string' || typeof p.value !== 'string') return null;
    params.push({ name: p.name, value: p.value });
  }
  return { workflow_instance_id: b.workflow_instance_id, step_instance_id: b.step_instance_id, step_oid: b.step_oid, input_parameters: params };
}

/** The action-server protocol exactly as MissionEngine/src/actions/client.ts reads it. */
export function createApp(deps: { db: Db; hub: EventHub; now: () => Date; pingMs?: number; token: string; corsOrigins: readonly string[] }): Hono {
  const { db, hub } = deps;
  const pingMs = deps.pingMs ?? 30_000;
  const app = new Hono();

  // CORS first so a 401 for an allowed origin still carries the headers (the Tester can show the error).
  app.use('*', cors({ origin: [...deps.corsOrigins], allowHeaders: ['Authorization', 'Content-Type'], allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'] }));
  app.use('*', brokerAuth(deps.token));

  app.get('/health', (c) => c.json({ ok: true }));

  app.get('/trajectory/v1/capabilities', (c) => c.json({
    data: { environments: [{
      environment_oid: BROKER_ENV.oid, environment_name: BROKER_ENV.name,
      actions: ACTIONS.map((a) => ({
        action_oid: a.oid, action_name: a.name, visibility: 'opaque',
        input_parameters: a.inputs.map((name) => ({ name })), supported_commands: ['ABORT'],
      })),
    }] },
  }));

  app.post('/trajectory/v1/actions/:oid/invoke', async (c) => {
    const body = parseInvoke(await c.req.json().catch(() => null));
    if (!body) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workflow_instance_id, step_instance_id, step_oid and input_parameters are required' } }, 400);
    let caller;
    try {
      caller = await loadCaller(db, body.workflow_instance_id, body.step_instance_id, body.step_oid);
    } catch (err) {
      if (err instanceof RemoteError) return c.json({ error: { code: 'FORBIDDEN', message: err.message } }, 403);
      throw err;
    }
    const action = findAction(c.req.param('oid'), caller.actionName);
    if (!action) return c.json({ error: { code: 'ACTION_NOT_FOUND', message: `No action "${caller.actionName ?? c.req.param('oid')}"` } }, 404);
    // The step must be waiting on THIS Mission Broker action. Every action server sees a step's ids
    // in its invoke body, so a step waiting on some other action must not be replayable here.
    // (action_invoked_oid is written only after the invoke returns, so the step's configured
    // action — its oid or, after an environment re-key, its name — is what we compare.)
    const configured = findAction(caller.actionOid ?? '', caller.actionName);
    if (!configured || configured.key !== action.key) {
      return c.json({ error: { code: 'FORBIDDEN', message: 'The calling step is not waiting on this action' } }, 403);
    }
    // Once per step activation: a repeated invoke (the engine timed out, or a duplicate POST)
    // returns the first instance and does not run the action again.
    const earlier = await findByActivation(db, caller.stepInstanceId, caller.stepStartedAt);
    if (earlier) return c.json({ data: { instance_id: earlier.id } }, 201);
    // Two invokes racing past the lookup may both execute; Create is still exactly once per
    // activation (createRuntime's createdByActivation), and the insert below keeps one row.
    const result = await execute(db, caller, action, body.input_parameters, deps.now());
    const inserted = await insertInstance(db, {
      actionKey: action.key, workflowInstanceId: caller.instanceId, stepInstanceId: caller.stepInstanceId,
      stepStartedAt: caller.stepStartedAt,
      targetInstanceId: result.state === 'RUNNING' ? result.targetInstanceId : null,
      state: result.state, outputs: result.state === 'COMPLETED' ? result.outputs : [],
    });
    const row = inserted ?? await findByActivation(db, caller.stepInstanceId, caller.stepStartedAt);
    if (!row) throw new Error('broker_action_instance insert conflicted but no row was found for the activation');
    return c.json({ data: { instance_id: row.id } }, 201);
  });

  app.get('/trajectory/v1/instances/:id', async (c) => {
    const id = c.req.param('id');
    const row = UUID_RE.test(id) ? await getInstance(db, id) : null;
    if (!row) return c.json({ error: { code: 'INSTANCE_NOT_FOUND' } }, 404);
    return c.json({ data: { state: row.state, outputs: row.outputs } }, 200);
  });

  app.post('/trajectory/v1/instances/:id/command', async (c) => {
    const id = c.req.param('id');
    const row = UUID_RE.test(id) ? await getInstance(db, id) : null;
    if (!row) return c.json({ error: { code: 'INSTANCE_NOT_FOUND' } }, 404);
    const raw: unknown = await c.req.json().catch(() => null);
    const command = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as { command?: unknown }).command : undefined;
    if (typeof command !== 'string') {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Request body must be a JSON object with a string "command"' } }, 400);
    }
    const refuse = (state: string) =>
      c.json({ error: { code: 'INVALID_STATE_TRANSITION', message: `Cannot ${command} from ${state}` } }, 409);
    if (command !== 'ABORT' || row.state !== 'RUNNING') return refuse(row.state);
    // A wake or the poll may finish the row between the read above and this update: then the row
    // keeps its real state and outputs, and the caller is told so instead of "ABORTED".
    const done = await finishInstance(db, id, 'ABORTED', []);
    if (!done) {
      const now = await getInstance(db, id);
      return refuse(now?.state ?? 'a deleted instance');
    }
    hub.publish(id, 'ABORTED', 'RUNNING');
    return c.json({ data: { accepted: true, new_state: 'ABORTED' } }, 200);
  });

  app.delete('/trajectory/v1/instances/:id', async (c) => {
    const id = c.req.param('id');
    const existed = UUID_RE.test(id) && await deleteInstance(db, id);
    return c.json({ data: { deleted: existed } }, existed ? 200 : 404);
  });

  app.get('/trajectory/v1/instances/:id/events', async (c) => {
    const id = c.req.param('id');
    const row = UUID_RE.test(id) ? await getInstance(db, id) : null;
    if (!row) return c.json({ error: { code: 'INSTANCE_NOT_FOUND' } }, 404);
    return streamSSE(c, async (stream) => {
      const unsubscribe = hub.subscribe(id, stream);
      // A comment line the engine's parser ignores (MissionEngine actions/sse.ts). It keeps a long
      // wait's stream from going silent past undici's 300 s body timeout, which would otherwise
      // drop the engine back to its 20 s poll.
      const ping = setInterval(() => { stream.write(': ping\n\n').catch(() => {}); }, pingMs);
      try {
        // Review Focus 1: the engine subscribes right after the 201, and every non-wait action is
        // already COMPLETED by then — announce it now instead of leaving the engine to its poll.
        const now = await getInstance(db, id);
        if (now && TERMINAL.has(now.state)) hub.send(stream, id, now.state, 'RUNNING');
        await new Promise<void>((resolve) => {
          // The client may already have gone while we were reading the row.
          if (stream.aborted || c.req.raw.signal.aborted) { resolve(); return; }
          stream.onAbort(() => resolve());
          c.req.raw.signal.addEventListener('abort', () => resolve(), { once: true });
        });
      } finally {
        clearInterval(ping);
        unsubscribe();
      }
    });
  });

  return app;
}
