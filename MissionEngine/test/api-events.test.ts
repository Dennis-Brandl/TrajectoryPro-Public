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
// Task 11: the operator-facing SSE fan-out. Two groups of hub-only unit tests (fake timers,
// no HTTP) exercise OperatorEventHub's debounce/coalesce/unregister/throwing-send behavior;
// one api-level test exercises the real `/api/events` route's first-event snapshot.
//
// Plus two carry-forward controller-ruling pins:
//  - Task 5 review: nothing anywhere previously asserted the `operator_change` NOTIFY payload
//    IS the work-center id (a payload-swap to instanceId would stay green until SSE silently
//    breaks). PGlite supports LISTEN/NOTIFY through its own `.listen()` JS API (confirmed against
//    node_modules/@electric-sql/pglite's type defs) — this test LISTENs for real and pumps a
//    spec that parks a USER_INTERACTION step (a real reconcile-producing action), then asserts
//    the delivered payload equals the seeded instance's work_center_id. Shipped: the REAL LISTEN
//    path, not a tx.execute spy fallback.
//  - Task 10 review: every Task-10 test ran with hub=null, so `hub?.notifyWorkCenter` was never
//    exercised. This file's last test wires a real (recording-subclass) OperatorEventHub into
//    makeApi, claims an offer through the route, and asserts the hub saw the call.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  workCenter, workflow, workflowInstance, stepInstance, instanceAssignment,
} from 'mission-control-db/src/db/schema/index';
import { makeTestDb } from './helpers/db.js';
import { testDeps, pumpUntilQuiet } from './helpers/pump.js';
import { makeApi } from './helpers/api.js';
import { OperatorEventHub } from '../src/api/events.js';
import { OPERATOR_CHANGE_CHANNEL } from '../src/core/reconcile.js';

// Lets a test make buildInbox fail once or wait on a deferred promise; default is the real one.
const inboxCtl = vi.hoisted(() => ({ hook: null as null | (() => Promise<void>), inflight: 0 }));
vi.mock('mission-control-db/src/runtime/inbox', async (importOriginal) => {
  const orig = await importOriginal<typeof import('mission-control-db/src/runtime/inbox')>();
  return {
    ...orig,
    buildInbox: async (...args: Parameters<typeof orig.buildInbox>) => {
      const hook = inboxCtl.hook;
      inboxCtl.inflight++;
      try {
        if (hook) await hook();
        return await orig.buildInbox(...args);
      } finally { inboxCtl.inflight--; }
    },
  };
});

type TestDb = Awaited<ReturnType<typeof makeTestDb>>['db'];

// ── shared fixture: a single fieldless USER_INTERACTION step, queued and ready to pump ──

const step = (oid: string, step_type: string) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01',
});

const UI_SPEC = {
  local_id: 'wf', oid: 'wf-events-ui', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [step('start', 'START'), step('ui-1', 'USER_INTERACTION'), step('end', 'END')],
  connections: [
    { from_step_id: 'start', to_step_id: 'ui-1' },
    { from_step_id: 'ui-1', to_step_id: 'end' },
  ],
};

async function seedQueued(db: TestDb, oid: string): Promise<{ id: string; workCenterId: string }> {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({
    workCenterId: wc.id, oid, name: oid, version: '1.0.0', state: 'Approved', specJsonb: UI_SPEC,
  }).returning();
  const runtimeNumber = Math.floor(Math.random() * 1_000_000) + 1;
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
    specJsonb: UI_SPEC, startingParams: null, runtimeNumber, runtimeLabel: `RW-${runtimeNumber}`,
    masterName: oid, masterOid: oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  return { id: wi.id, workCenterId: wc.id };
}

async function offeredAssignmentId(db: TestDb, instanceId: string): Promise<string> {
  const rows = await db.select({ id: instanceAssignment.id, status: instanceAssignment.status })
    .from(instanceAssignment)
    .innerJoin(stepInstance, eq(instanceAssignment.stepInstanceId, stepInstance.id))
    .where(eq(stepInstance.workflowInstanceId, instanceId));
  const offered = rows.find((r) => r.status === 'offered');
  if (!offered) throw new Error(`no offered assignment for instance ${instanceId}`);
  return offered.id;
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

// ── 1-4. OperatorEventHub unit tests (fake timers, no HTTP) ──

beforeEach(() => { vi.useFakeTimers(); inboxCtl.hook = null; });
afterEach(() => { vi.useRealTimers(); });

test('notifyWorkCenter pushes one snapshot per registered session of that WC after the debounce window; other WCs get nothing', async () => {
  const { db, close } = await makeTestDb();
  const hub = new OperatorEventHub(db, 100);
  const [wcA] = await db.insert(workCenter).values({ name: 'A' }).returning();
  const [wcB] = await db.insert(workCenter).values({ name: 'B' }).returning();
  const sendA = vi.fn();
  const sendB = vi.fn();
  hub.register('key-a', { userId: crypto.randomUUID(), workCenterId: wcA.id, send: sendA });
  hub.register('key-b', { userId: crypto.randomUUID(), workCenterId: wcB.id, send: sendB });

  hub.notifyWorkCenter(wcA.id);
  await vi.advanceTimersByTimeAsync(150);

  expect(sendA).toHaveBeenCalledTimes(1);
  expect(sendA.mock.calls[0][0]).toMatchObject({ workCenterId: wcA.id, offers: [], myClaims: [] });
  expect(sendB).not.toHaveBeenCalled();
  await close();
});

test('two notifies inside the debounce window coalesce to one push', async () => {
  const { db, close } = await makeTestDb();
  const hub = new OperatorEventHub(db, 100);
  const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
  const send = vi.fn();
  hub.register('key', { userId: crypto.randomUUID(), workCenterId: wc.id, send });

  hub.notifyWorkCenter(wc.id);
  await vi.advanceTimersByTimeAsync(50);
  hub.notifyWorkCenter(wc.id); // inside the window — must NOT reset/duplicate the pending push
  await vi.advanceTimersByTimeAsync(100);

  expect(send).toHaveBeenCalledTimes(1);
  await close();
});

test('unregister stops pushes', async () => {
  const { db, close } = await makeTestDb();
  const hub = new OperatorEventHub(db, 100);
  const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
  const send = vi.fn();
  hub.register('key', { userId: crypto.randomUUID(), workCenterId: wc.id, send });

  hub.notifyWorkCenter(wc.id);
  hub.unregister('key');
  await vi.advanceTimersByTimeAsync(150);

  expect(send).not.toHaveBeenCalled();
  await close();
});

test('a send() that throws is swallowed: that session is dropped, others in the same WC still served', async () => {
  const { db, close } = await makeTestDb();
  const hub = new OperatorEventHub(db, 100);
  const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
  const throwing = vi.fn(() => { throw new Error('boom'); });
  const healthy = vi.fn();
  hub.register('bad', { userId: crypto.randomUUID(), workCenterId: wc.id, send: throwing });
  hub.register('good', { userId: crypto.randomUUID(), workCenterId: wc.id, send: healthy });

  hub.notifyWorkCenter(wc.id);
  await vi.advanceTimersByTimeAsync(150);
  expect(throwing).toHaveBeenCalledTimes(1);
  expect(healthy).toHaveBeenCalledTimes(1);

  // Second round: the throwing session was dropped, so it must NOT be called again — only
  // the still-registered healthy session gets served.
  hub.notifyWorkCenter(wc.id);
  await vi.advanceTimersByTimeAsync(150);
  expect(throwing).toHaveBeenCalledTimes(1);
  expect(healthy).toHaveBeenCalledTimes(2);
  await close();
});

test('a buildInbox failure keeps the session; the next notify sends', async () => {
  const { db, close } = await makeTestDb();
  const hub = new OperatorEventHub(db, 100);
  const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
  const send = vi.fn();
  hub.register('key', { userId: crypto.randomUUID(), workCenterId: wc.id, send });
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  let calls = 0;
  inboxCtl.hook = async () => { if (calls++ === 0) throw new Error('db blip'); };

  hub.notifyWorkCenter(wc.id);
  await vi.advanceTimersByTimeAsync(150);
  expect(send).not.toHaveBeenCalled();
  expect(hub.sessionCount).toBe(1);
  expect(errSpy).toHaveBeenCalled();

  hub.notifyWorkCenter(wc.id);
  await vi.advanceTimersByTimeAsync(150);
  expect(send).toHaveBeenCalledTimes(1);
  errSpy.mockRestore();
  await close();
});

test('a send failure removes the session', async () => {
  const { db, close } = await makeTestDb();
  const hub = new OperatorEventHub(db, 100);
  const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
  hub.register('key', { userId: crypto.randomUUID(), workCenterId: wc.id, send: () => { throw new Error('closed'); } });
  hub.notifyWorkCenter(wc.id);
  await vi.advanceTimersByTimeAsync(150);
  expect(hub.sessionCount).toBe(0);
  await close();
});

// ── 5. SSE route: first event is a full snapshot ──

test('GET /api/events returns text/event-stream and its first event is a full inbox snapshot', async () => {
  vi.useRealTimers(); // real HTTP/stream plumbing — fake timers would stall the fetch machinery
  // The hub's own db is a throwaway PGlite: this test only exercises registration, the FIRST
  // snapshot write (computed through the APP's own db, in the route closure — see events.ts's
  // `await buildInbox(db, ...)` before the loop), and unregister-on-abort. `hub.push()` — the
  // only path that reads through the hub's OWN db — never runs in this test.
  const { db: hubDb, close: closeHubDb } = await makeTestDb();
  const hub = new OperatorEventHub(hubDb);
  const { db, app, cookieFor, seedOperator, close } = await makeApi(hub);
  const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
  await seedOperator('op-events@example.com', wc.id);
  const cookie = await cookieFor('op-events@example.com');

  const res = await app.request(`/api/events?workCenterId=${wc.id}`, { headers: { cookie } });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);

  const reader = res.body!.getReader();
  const { value } = await reader.read();
  const chunk = new TextDecoder().decode(value);
  const dataLine = chunk.split('\n').find((l) => l.startsWith('data: '));
  expect(dataLine).toBeDefined();
  const snapshot = JSON.parse(dataLine!.slice('data: '.length)) as { workCenterId: string; offers: unknown[]; myClaims: unknown[] };
  expect(snapshot.workCenterId).toBe(wc.id);
  expect(Array.isArray(snapshot.offers)).toBe(true);
  expect(Array.isArray(snapshot.myClaims)).toBe(true);

  await reader.cancel(); // triggers stream.abort() -> hub.unregister; stops the keep-alive loop
  await close();
  await closeHubDb();
});

test('aborting during the first snapshot leaves no session', async () => {
  vi.useRealTimers();
  const { db: hubDb, close: closeHubDb } = await makeTestDb();
  const hub = new OperatorEventHub(hubDb);
  const { db, app, cookieFor, seedOperator, close } = await makeApi(hub);
  const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
  await seedOperator('op-events-abort@example.com', wc.id);
  const cookie = await cookieFor('op-events-abort@example.com');

  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let entered!: () => void;
  const enteredP = new Promise<void>((r) => { entered = r; });
  inboxCtl.hook = async () => { entered(); await gate; };

  const ac = new AbortController();
  const res = await app.request(new Request(`http://localhost/api/events?workCenterId=${wc.id}`, { headers: { cookie }, signal: ac.signal }));
  const reader = res.body!.getReader();
  const pending = reader.read().catch(() => undefined);
  await enteredP;
  expect(hub.sessionCount).toBe(1);
  ac.abort();
  await reader.cancel().catch(() => {});
  release();
  await pending;
  await waitFor(() => inboxCtl.inflight === 0); // the deferred build has finished before the db closes
  await waitFor(() => hub.sessionCount === 0); // the route's finally has run
  expect(hub.sessionCount).toBe(0);

  await close();
  await closeHubDb();
});

test('GET /api/events -> 400 missing workCenterId, 403 non-member, 503 when hub is null', async () => {
  vi.useRealTimers();
  const { db, app, cookieFor, seedOperator, close } = await makeApi(null);
  const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
  await seedOperator('op-events-guard@example.com', wc.id);
  const cookie = await cookieFor('op-events-guard@example.com');

  const missing = await app.request('/api/events', { headers: { cookie } });
  expect(missing.status).toBe(400);

  const nullHub = await app.request(`/api/events?workCenterId=${wc.id}`, { headers: { cookie } });
  expect(nullHub.status).toBe(503);

  await seedOperator('op-events-nonmember@example.com');
  const nonMemberCookie = await cookieFor('op-events-nonmember@example.com');
  const forbidden = await app.request(`/api/events?workCenterId=${wc.id}`, { headers: { cookie: nonMemberCookie } });
  expect(forbidden.status).toBe(403);
  await close();
});

// ── 6. Carry-forward pin (Task 5 review): the operator_change NOTIFY payload IS the
//        work_center_id — proven via a REAL PGlite LISTEN, not a tx.execute spy. ──

test('PIN: operator_change NOTIFY payload equals the instance work_center_id (real PGlite LISTEN)', async () => {
  vi.useRealTimers();
  const { db, client, close } = await makeTestDb();
  const received: string[] = [];
  await client.listen(OPERATOR_CHANGE_CHANNEL, (payload) => { received.push(payload); });

  const deps = testDeps();
  const wi = await seedQueued(db, 'wf-events-pin1');
  await pumpUntilQuiet(db, deps); // activates the UI step -> reconcileAssignments creates an
                                  // offer -> reconcileAndNotify pg_notifies OPERATOR_CHANGE_CHANNEL

  await waitFor(() => received.length > 0);
  expect(received[0]).toBe(wi.workCenterId);

  // Sanity: the offer really exists (confirms this was a reconcile-producing action, not a
  // no-op that happened to leave `received` populated from an unrelated earlier notify).
  await offeredAssignmentId(db, wi.id);
  await close();
});

// ── 7. Carry-forward pin (Task 10 review): claim/release/submit's `hub?.notifyWorkCenter(...)`
//        fan-out was NEVER exercised (every Task-10 test ran hub=null). ──

class RecordingHub extends OperatorEventHub {
  calls: string[] = [];
  override notifyWorkCenter(wcId: string): void {
    this.calls.push(wcId);
    super.notifyWorkCenter(wcId);
  }
}

test('PIN: claiming an offer through the route calls hub.notifyWorkCenter(<that WC id>)', async () => {
  // The hub's own db is a throwaway PGlite — never touched here, since no session is ever
  // registered for this WC (push() iterates zero sessions and returns without querying).
  const { db: hubDb, close: closeHubDb } = await makeTestDb();
  const hub = new RecordingHub(hubDb);
  const { db, app, cookieFor, seedOperator, deps, close } = await makeApi(hub);
  const wi = await seedQueued(db, 'wf-events-pin2');
  await pumpUntilQuiet(db, deps);
  await seedOperator('op-events-pin2@example.com', wi.workCenterId);
  const cookie = await cookieFor('op-events-pin2@example.com');
  const assignmentId = await offeredAssignmentId(db, wi.id);

  const res = await app.request(`/api/assignments/${assignmentId}/claim`, { method: 'POST', headers: { cookie } });
  expect(res.status).toBe(200);
  expect(hub.calls).toContain(wi.workCenterId);

  await close();
  await closeHubDb();
});
