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
// Task 8: the operator API scaffold (src/api/app.ts) — session gate, /api/me, /api/work-centers,
// presence create/heartbeat/delete, and /api/logout. Uses Hono's app.request(...) directly
// (no server needed) against a fresh PGlite db per test, through the SAME better-auth mount
// the app itself uses (test/helpers/api.ts's makeApi()) so cookies issued by sign-in actually
// authenticate against the session gate.
import { expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  workCenter, workCenterUser, operatorPresence, instanceAssignment,
  workflow, workflowInstance, stepInstance, appUser,
} from 'mission-control-db/src/db/schema/index';
import { makeApi, type ApiHarness } from './helpers/api.js';
import { pumpUntilQuiet } from './helpers/pump.js';

const jsonHeaders = (cookie: string) => ({ cookie, 'content-type': 'application/json' });

/** Direct-insert fixture for Task 8's logout test: a claimed instance_assignment row, wired
 *  through the minimum workflow/instance/step chain the FKs require. No engine pump needed —
 *  logout only reads/writes instance_assignment and operator_presence. */
async function seedClaimedAssignment(db: ApiHarness['db'], workCenterId: string, userId: string): Promise<string> {
  const oid = `wf-logout-${Math.random()}`;
  const spec = { local_id: 'wf', oid, version: '1.0.0', last_modified_date: '2026-01-01', steps: [], connections: [] };
  const [wf] = await db.insert(workflow).values({
    workCenterId, oid, name: oid, version: '1.0.0', state: 'Approved', specJsonb: spec,
  }).returning();
  const runtimeNumber = Math.floor(Math.random() * 1_000_000) + 1;
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId, triggeredBy: 'manual', status: 'running',
    specJsonb: spec, runtimeNumber, runtimeLabel: `RW-${runtimeNumber}`,
    masterName: oid, masterOid: oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  const [step] = await db.insert(stepInstance).values({
    workflowInstanceId: wi.id, nodeOid: 'ui-1', stepOid: 'ui-1', stepType: 'USER_INTERACTION', state: 'WAITING_USER',
  }).returning();
  const [assignment] = await db.insert(instanceAssignment).values({
    stepInstanceId: step.id, workCenterId, status: 'claimed', assignedUserId: userId, claimedAt: new Date(),
  }).returning();
  return assignment.id;
}

// ── 1. unauthenticated ──

test('unauthenticated GET /api/me -> 401', async () => {
  const { app, close } = await makeApi();
  const res = await app.request('/api/me');
  expect(res.status).toBe(401);
  await close();
});

// ── 2. /api/me ──

test('GET /api/me returns the caller with loginName and no role list', async () => {
  const { app, cookieFor, seedOperator, close } = await makeApi();
  const userId = await seedOperator('op-me@example.com');
  const cookie = await cookieFor('op-me@example.com');

  const res = await app.request('/api/me', { headers: { cookie } });
  expect(res.status).toBe(200);
  const body = await res.json() as { id: string; email: string; displayName: string; loginName: string; roles?: unknown };
  expect(body.id).toBe(userId);
  expect(body.email).toBe('op-me@example.com');
  expect(body.loginName).toBe('op-me');       // derived by the 0031 trigger from the email
  expect(body).not.toHaveProperty('roles');
  await close();
});

// ── 3. /api/work-centers ──

test('GET /api/work-centers returns only work centers I belong to', async () => {
  const { db, app, cookieFor, seedOperator, close } = await makeApi();
  const [mine] = await db.insert(workCenter).values({ name: 'Mine' }).returning();
  await db.insert(workCenter).values({ name: 'Other' }).returning();
  await seedOperator('op-wc@example.com', mine.id);
  const cookie = await cookieFor('op-wc@example.com');

  const res = await app.request('/api/work-centers', { headers: { cookie } });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([{ id: mine.id, name: 'Mine', path: [], openTasks: 0 }]);
  await close();
});

// ── 4. presence: non-member -> 403 ──

test('POST /api/presence for a non-member work center -> 403', async () => {
  const { db, app, cookieFor, seedOperator, close } = await makeApi();
  const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
  await seedOperator('op-nonmember@example.com'); // deliberately no work_center_user row
  const cookie = await cookieFor('op-nonmember@example.com');

  const res = await app.request('/api/presence', {
    method: 'POST', headers: jsonHeaders(cookie), body: JSON.stringify({ workCenterId: wc.id }),
  });
  expect(res.status).toBe(403);
  await close();
});

// ── 5. presence: create + switch ──

test('POST /api/presence creates a session-scoped row; switching work centers replaces it', async () => {
  const { db, app, cookieFor, seedOperator, close } = await makeApi();
  const [wc1] = await db.insert(workCenter).values({ name: 'WC1' }).returning();
  const [wc2] = await db.insert(workCenter).values({ name: 'WC2' }).returning();
  const userId = await seedOperator('op-presence@example.com', wc1.id);
  await db.insert(workCenterUser).values({ workCenterId: wc2.id, userId });
  const cookie = await cookieFor('op-presence@example.com');

  const res1 = await app.request('/api/presence', {
    method: 'POST', headers: jsonHeaders(cookie), body: JSON.stringify({ workCenterId: wc1.id }),
  });
  expect(res1.status).toBe(200);
  let rows = await db.select().from(operatorPresence).where(eq(operatorPresence.userId, userId));
  expect(rows).toHaveLength(1);
  expect(rows[0].attendingWorkCenterId).toBe(wc1.id);
  expect(rows[0].status).toBe('online');
  const firstRowId = rows[0].id;

  const res2 = await app.request('/api/presence', {
    method: 'POST', headers: jsonHeaders(cookie), body: JSON.stringify({ workCenterId: wc2.id }),
  });
  expect(res2.status).toBe(200);
  rows = await db.select().from(operatorPresence).where(eq(operatorPresence.userId, userId));
  expect(rows).toHaveLength(1);
  expect(rows[0].id).not.toBe(firstRowId);
  expect(rows[0].attendingWorkCenterId).toBe(wc2.id);
  await close();
});

test('switching: POST B then a late DELETE for A keeps the B row', async () => {
  const { db, app, cookieFor, seedOperator, close } = await makeApi();
  const [wc1] = await db.insert(workCenter).values({ name: 'WC1' }).returning();
  const [wc2] = await db.insert(workCenter).values({ name: 'WC2' }).returning();
  const userId = await seedOperator('op-late-delete@example.com', wc1.id);
  await db.insert(workCenterUser).values({ workCenterId: wc2.id, userId });
  const cookie = await cookieFor('op-late-delete@example.com');
  for (const id of [wc1.id, wc2.id]) {
    await app.request('/api/presence', {
      method: 'POST', headers: jsonHeaders(cookie), body: JSON.stringify({ workCenterId: id }),
    });
  }
  const res = await app.request(`/api/presence?workCenterId=${wc1.id}`, { method: 'DELETE', headers: { cookie } });
  expect(res.status).toBe(200);
  const rows = await db.select().from(operatorPresence).where(eq(operatorPresence.userId, userId));
  expect(rows).toHaveLength(1);
  expect(rows[0].attendingWorkCenterId).toBe(wc2.id);
  await close();
});

test('DELETE with a malformed workCenterId -> 400, not a 500', async () => {
  const { db, app, cookieFor, seedOperator, close } = await makeApi();
  const [wc1] = await db.insert(workCenter).values({ name: 'WC1' }).returning();
  await seedOperator('op-bad-delete@example.com', wc1.id);
  const cookie = await cookieFor('op-bad-delete@example.com');
  const res = await app.request('/api/presence?workCenterId=not-a-uuid', { method: 'DELETE', headers: { cookie } });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: 'invalid work center id' });
  await close();
});

test('DELETE without workCenterId still removes the session presence', async () => {
  const { db, app, cookieFor, seedOperator, close } = await makeApi();
  const [wc1] = await db.insert(workCenter).values({ name: 'WC1' }).returning();
  const userId = await seedOperator('op-plain-delete@example.com', wc1.id);
  const cookie = await cookieFor('op-plain-delete@example.com');
  await app.request('/api/presence', {
    method: 'POST', headers: jsonHeaders(cookie), body: JSON.stringify({ workCenterId: wc1.id }),
  });
  const res = await app.request('/api/presence', { method: 'DELETE', headers: { cookie } });
  expect(res.status).toBe(200);
  const rows = await db.select().from(operatorPresence).where(eq(operatorPresence.userId, userId));
  expect(rows).toHaveLength(0);
  await close();
});

// ── 6. heartbeat ──

test('POST /api/presence/heartbeat updates status and always advances lastHeartbeatAt', async () => {
  const { db, app, cookieFor, seedOperator, close } = await makeApi();
  const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
  const userId = await seedOperator('op-heartbeat@example.com', wc.id);
  const cookie = await cookieFor('op-heartbeat@example.com');
  await app.request('/api/presence', {
    method: 'POST', headers: jsonHeaders(cookie), body: JSON.stringify({ workCenterId: wc.id }),
  });
  const rowFor = async () => (await db.select().from(operatorPresence).where(eq(operatorPresence.userId, userId)))[0];
  const initial = await rowFor();

  await new Promise((r) => setTimeout(r, 5));
  const awayRes = await app.request('/api/presence/heartbeat', {
    method: 'POST', headers: jsonHeaders(cookie), body: JSON.stringify({ status: 'away' }),
  });
  expect(awayRes.status).toBe(200);
  let row = await rowFor();
  expect(row.status).toBe('away');
  expect(row.lastHeartbeatAt.getTime()).toBeGreaterThan(initial.lastHeartbeatAt.getTime());

  const backRes = await app.request('/api/presence/heartbeat', {
    method: 'POST', headers: jsonHeaders(cookie), body: JSON.stringify({ status: 'back' }),
  });
  expect(backRes.status).toBe(200);
  row = await rowFor();
  expect(row.status).toBe('online');

  const beforeOmit = row.lastHeartbeatAt.getTime();
  await new Promise((r) => setTimeout(r, 5));
  const omitRes = await app.request('/api/presence/heartbeat', { method: 'POST', headers: { cookie } });
  expect(omitRes.status).toBe(200);
  row = await rowFor();
  expect(row.status).toBe('online'); // unchanged when status omitted
  expect(row.lastHeartbeatAt.getTime()).toBeGreaterThan(beforeOmit);

  await close();
});

// ── 7. delete presence ──

test('DELETE /api/presence removes my session-scoped row', async () => {
  const { db, app, cookieFor, seedOperator, close } = await makeApi();
  const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
  const userId = await seedOperator('op-delete@example.com', wc.id);
  const cookie = await cookieFor('op-delete@example.com');
  await app.request('/api/presence', {
    method: 'POST', headers: jsonHeaders(cookie), body: JSON.stringify({ workCenterId: wc.id }),
  });

  const delRes = await app.request('/api/presence', { method: 'DELETE', headers: { cookie } });
  expect(delRes.status).toBe(200);
  const rows = await db.select().from(operatorPresence).where(eq(operatorPresence.userId, userId));
  expect(rows).toHaveLength(0);
  await close();
});

// ── 8. GET /api/inbox ──

/** Direct-insert fixture for Task 9's inbox route case: an unclaimed, unrestricted offer,
 *  wired through the minimum workflow/instance/step chain (same shape as seedClaimedAssignment). */
async function seedOfferedAssignment(db: ApiHarness['db'], workCenterId: string): Promise<{ stepOid: string }> {
  const oid = `wf-inbox-${Math.random()}`;
  const spec = { local_id: 'wf', oid, version: '1.0.0', last_modified_date: '2026-01-01', steps: [], connections: [] };
  const [wf] = await db.insert(workflow).values({
    workCenterId, oid, name: oid, version: '1.0.0', state: 'Approved', specJsonb: spec,
  }).returning();
  const runtimeNumber = Math.floor(Math.random() * 1_000_000) + 1;
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId, triggeredBy: 'manual', status: 'running',
    specJsonb: spec, runtimeNumber, runtimeLabel: `RW-${runtimeNumber}`,
    masterName: oid, masterOid: oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  const stepOid = `ui-${Math.random()}`;
  const [step] = await db.insert(stepInstance).values({
    workflowInstanceId: wi.id, nodeOid: oid, stepOid, stepType: 'USER_INTERACTION', state: 'WAITING_USER',
  }).returning();
  await db.insert(instanceAssignment).values({
    stepInstanceId: step.id, workCenterId, status: 'offered', allowedRoleIds: [],
  });
  return { stepOid };
}

test('GET /api/inbox returns a seeded offer for a work-center member', async () => {
  const { db, app, cookieFor, seedOperator, close } = await makeApi();
  const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
  await seedOperator('op-inbox@example.com', wc.id);
  const cookie = await cookieFor('op-inbox@example.com');
  const { stepOid } = await seedOfferedAssignment(db, wc.id);

  const res = await app.request(`/api/inbox?workCenterId=${wc.id}`, { headers: { cookie } });
  expect(res.status).toBe(200);
  const body = await res.json() as { workCenterId: string; offers: { stepOid: string }[]; myClaims: unknown[] };
  expect(body.workCenterId).toBe(wc.id);
  expect(body.offers.map((o) => o.stepOid)).toEqual([stepOid]);
  expect(body.myClaims).toEqual([]);
  await close();
});

test('GET /api/inbox for a non-member work center -> 403', async () => {
  const { db, app, cookieFor, seedOperator, close } = await makeApi();
  const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
  await seedOperator('op-inbox-nonmember@example.com'); // deliberately no work_center_user row
  const cookie = await cookieFor('op-inbox-nonmember@example.com');

  const res = await app.request(`/api/inbox?workCenterId=${wc.id}`, { headers: { cookie } });
  expect(res.status).toBe(403);
  await close();
});

test('a malformed work-center id is a 400, never a 500 from the uuid cast (inbox, events, presence)', async () => {
  const { db, app, cookieFor, seedOperator, close } = await makeApi();
  const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
  await seedOperator('op-badid@example.com', wc.id);
  const cookie = await cookieFor('op-badid@example.com');

  for (const bad of ['x', 'not-a-uuid', `${wc.id}x`]) {
    const inbox = await app.request(`/api/inbox?workCenterId=${encodeURIComponent(bad)}`, { headers: { cookie } });
    expect(inbox.status, `inbox ${bad}`).toBe(400);
    const events = await app.request(`/api/events?workCenterId=${encodeURIComponent(bad)}`, { headers: { cookie } });
    expect(events.status, `events ${bad}`).toBe(400);
    const presence = await app.request('/api/presence', {
      method: 'POST', headers: jsonHeaders(cookie), body: JSON.stringify({ workCenterId: bad }),
    });
    expect(presence.status, `presence ${bad}`).toBe(400);
  }
  const notString = await app.request('/api/presence', {
    method: 'POST', headers: jsonHeaders(cookie), body: JSON.stringify({ workCenterId: 42 }),
  });
  expect(notString.status).toBe(400);
  await close();
});

test('a malformed assignment id on claim, release or submit is a 404, never a 500', async () => {
  const { db, app, cookieFor, seedOperator, close } = await makeApi();
  const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
  await seedOperator('op-badassign@example.com', wc.id);
  const cookie = await cookieFor('op-badassign@example.com');

  for (const verb of ['claim', 'release', 'submit']) {
    const res = await app.request(`/api/assignments/not-a-uuid/${verb}`, {
      method: 'POST', headers: jsonHeaders(cookie), body: JSON.stringify({ kind: 'complete' }),
    });
    expect(res.status, verb).toBe(404);
  }
  await close();
});

// ── 9. logout ──

test('POST /api/logout releases my claims, ends this session presence, and ends the session', async () => {
  const { db, app, cookieFor, seedOperator, close } = await makeApi();
  const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
  const userId = await seedOperator('op-logout@example.com', wc.id);
  const cookie = await cookieFor('op-logout@example.com');
  await app.request('/api/presence', {
    method: 'POST', headers: jsonHeaders(cookie), body: JSON.stringify({ workCenterId: wc.id }),
  });
  const assignmentId = await seedClaimedAssignment(db, wc.id, userId);

  const res = await app.request('/api/logout', { method: 'POST', headers: { cookie } });
  expect(res.status).toBe(200);

  const [assignment] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.id, assignmentId));
  expect(assignment.status).toBe('offered');
  expect(assignment.assignedUserId).toBeNull();
  expect(assignment.releasedFromUserId).toBe(userId);

  const presenceRows = await db.select().from(operatorPresence).where(eq(operatorPresence.userId, userId));
  expect(presenceRows).toHaveLength(0);

  const meRes = await app.request('/api/me', { headers: { cookie } });
  expect(meRes.status).toBe(401);

  await close();
});

test('POST /api/auth/sign-out (better-auth\'s own endpoint) also releases my claims and ends this session presence', async () => {
  const { db, app, cookieFor, seedOperator, close } = await makeApi();
  const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
  const userId = await seedOperator('op-signout@example.com', wc.id);
  const cookie = await cookieFor('op-signout@example.com');
  await app.request('/api/presence', {
    method: 'POST', headers: jsonHeaders(cookie), body: JSON.stringify({ workCenterId: wc.id }),
  });
  const assignmentId = await seedClaimedAssignment(db, wc.id, userId);

  // A stock better-auth client calls this endpoint directly — never the bespoke /api/logout.
  const res = await app.request('/api/auth/sign-out', { method: 'POST', headers: { cookie } });
  expect(res.status).toBe(200);

  const [assignment] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.id, assignmentId));
  expect(assignment.status).toBe('offered');
  expect(assignment.assignedUserId).toBeNull();
  expect(assignment.claimedAt).toBeNull();
  expect(assignment.resolvedRoleId).toBeNull();
  expect(assignment.releasedFromUserId).toBe(userId);

  const presenceRows = await db.select().from(operatorPresence).where(eq(operatorPresence.userId, userId));
  expect(presenceRows).toHaveLength(0);

  const meRes = await app.request('/api/me', { headers: { cookie } });
  expect(meRes.status).toBe(401);

  await close();
});

// ── Sole-candidate sweep triggers (spec 2026-08-17 D14b) ──

const SOLE_SPEC = {
  local_id: 'wf', oid: 'wf-sole', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [
    { local_id: 'start', oid: 'start', step_type: 'START', version: '1.0.0', last_modified_date: '2026-01-01' },
    { local_id: 'ui-1', oid: 'ui-1', step_type: 'USER_INTERACTION', version: '1.0.0', last_modified_date: '2026-01-01' },
    { local_id: 'end', oid: 'end', step_type: 'END', version: '1.0.0', last_modified_date: '2026-01-01' },
  ],
  connections: [
    { from_step_id: 'start', to_step_id: 'ui-1' },
    { from_step_id: 'ui-1', to_step_id: 'end' },
  ],
};

async function seedSoleInstance(db: any): Promise<{ wcId: string }> {
  const [wc] = await db.insert(workCenter).values({ name: `wc-sole-${Math.random()}`, autoClaim: true }).returning();
  const [wf] = await db.insert(workflow).values({
    workCenterId: wc.id, oid: `wf-sole-${Math.random()}`, name: 'wf-sole', version: '1.0.0', state: 'Approved', specJsonb: SOLE_SPEC,
  }).returning();
  const soleRuntimeNumber = Math.floor(Math.random() * 1_000_000) + 1;
  await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
    specJsonb: SOLE_SPEC, runtimeNumber: soleRuntimeNumber, runtimeLabel: `RW-${soleRuntimeNumber}`,
    masterName: 'wf-sole', masterOid: 'wf-sole', masterVersion: '1.0.0', masterState: 'Approved',
  });
  return { wcId: wc.id };
}

async function soleAssignmentRow(db: any, wcId: string) {
  const [row] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.workCenterId, wcId));
  return row;
}

test('presence arrival sweeps: a no-candidate offer claims to the arriving sole operator (RW-15)', async () => {
  const { db, app, deps, cookieFor, seedOperator, close } = await makeApi();
  const { wcId } = await seedSoleInstance(db);
  await pumpUntilQuiet(db, deps);                        // the run parks; nobody online -> plain offer
  expect((await soleAssignmentRow(db, wcId)).status).toBe('offered');
  const userId = await seedOperator('sole-arrival@example.com', wcId);
  const cookie = await cookieFor('sole-arrival@example.com');
  const res = await app.request('/api/presence', {
    method: 'POST', headers: jsonHeaders(cookie), body: JSON.stringify({ workCenterId: wcId }),
  });
  expect(res.status).toBe(200);
  const row = await soleAssignmentRow(db, wcId);
  expect(row.status).toBe('claimed');
  expect(row.assignedUserId).toBe(userId);
  expect(row.dispatchReason).toBe('auto_claim_sole_candidate');
  await close();
});

test('heartbeat away sweeps: the departing second operator makes the remaining one sole', async () => {
  const { db, app, deps, cookieFor, seedOperator, close } = await makeApi();
  const { wcId } = await seedSoleInstance(db);
  const stayId = await seedOperator('sole-stay@example.com', wcId);
  await seedOperator('sole-leave@example.com', wcId);
  const stayCookie = await cookieFor('sole-stay@example.com');
  const leaveCookie = await cookieFor('sole-leave@example.com');
  await app.request('/api/presence', { method: 'POST', headers: jsonHeaders(stayCookie), body: JSON.stringify({ workCenterId: wcId }) });
  await app.request('/api/presence', { method: 'POST', headers: jsonHeaders(leaveCookie), body: JSON.stringify({ workCenterId: wcId }) });
  await pumpUntilQuiet(db, deps);                        // parked with TWO online -> contested -> offered
  expect((await soleAssignmentRow(db, wcId)).status).toBe('offered');
  const res = await app.request('/api/presence/heartbeat', {
    method: 'POST', headers: jsonHeaders(leaveCookie), body: JSON.stringify({ status: 'away' }),
  });
  expect(res.status).toBe(200);
  const row = await soleAssignmentRow(db, wcId);
  expect(row.status).toBe('claimed');
  expect(row.assignedUserId).toBe(stayId);
  await close();
});

test('a status-free heartbeat never sweeps', async () => {
  const { db, app, deps, cookieFor, seedOperator, close } = await makeApi();
  const { wcId } = await seedSoleInstance(db);
  await pumpUntilQuiet(db, deps);
  await seedOperator('sole-noop@example.com', wcId);
  const cookie = await cookieFor('sole-noop@example.com');
  // Presence row inserted DIRECTLY (not via the route) so no arrival sweep has fired yet.
  const [me] = await db.select({ id: appUser.id }).from(appUser).where(eq(appUser.email, 'sole-noop@example.com'));
  await db.insert(operatorPresence).values({ userId: me.id, attendingWorkCenterId: wcId, sessionId: `direct-${Math.random()}`, status: 'online' });
  await app.request('/api/presence/heartbeat', { method: 'POST', headers: { cookie } });
  expect((await soleAssignmentRow(db, wcId)).status).toBe('offered');   // transitionless -> untouched
  await close();
});

test('heartbeat with a null body is 200', async () => {
  const { db, app, cookieFor, seedOperator, close } = await makeApi();
  const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
  await seedOperator('op-hb-null@example.com', wc.id);
  const cookie = await cookieFor('op-hb-null@example.com');
  await app.request('/api/presence', {
    method: 'POST', headers: jsonHeaders(cookie), body: JSON.stringify({ workCenterId: wc.id }),
  });
  const res = await app.request('/api/presence/heartbeat', {
    method: 'POST', headers: jsonHeaders(cookie), body: 'null',
  });
  expect(res.status).toBe(200);
  await close();
});
