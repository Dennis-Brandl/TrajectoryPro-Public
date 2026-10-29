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
// Phase 6 (spec §3): the CM-server-facing internal API. Token-gated, NOT operator-session-
// gated — these routes share the public port, so the token is the sole gate and it FAILS
// CLOSED: no ENGINE_INTERNAL_TOKEN configured means every /internal/* request 401s. The four
// controls write the same transitional statuses the runtime-control DAOs define; the worker
// loop (runControlPass) picks them up on its normal ~1 s cycle — no nudge needed.
//
// Error-envelope convention: every /internal/* error body is `{ error: { code, message } }`
// with `code` in UPPER_SNAKE (matching DaoError's codes). The CM client reads only `message`
// and the HTTP status, never `code` — so these strings are engine-local, free to change.
import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { requestPause, requestResume, requestStop, requestAbort } from 'mission-control-db/src/dao/runtime-control';
import { DaoError } from 'mission-control-db/src/dao/errors';
import { resolveStepAllowedRoles, sweepSoleCandidateClaims } from 'mission-control-db/src/runtime/assignments';
import { instanceAssignment, stepInstance, workflowInstance, workCenterUserRole } from 'mission-control-db/src/db/schema/index';
import type { Db } from '../db.js';
import type { EngineDeps } from '../config.js';
import type { OperatorEventHub } from './events.js';
import { OPERATOR_CHANGE_CHANNEL } from '../core/reconcile.js';
import { requireWcMember } from './app.js';
import { forceCompleteStep } from '../core/force-complete.js';
import { RESOURCE_VERBS, VerbError, type ResourceVerb } from '../core/registry-verbs.js';
import {
  runWorkCenterResourceVerb, runInstanceResourceVerb, setWorkCenterValueProperty, setInstanceValueProperty,
} from '../core/operator-verbs.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tokenMatches(got: string, expected: string): boolean {
  const a = Buffer.from(got); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const CONTROLS = { pause: requestPause, resume: requestResume, stop: requestStop, abort: requestAbort } as const;

export function createInternalApp(db: Db, deps: EngineDeps, hub: OperatorEventHub | null): Hono {
  const app = new Hono();

  app.use('/internal/*', async (c, next) => {
    const expected = deps.config.internalToken;
    const got = c.req.header('x-internal-token') ?? '';
    if (!expected || !tokenMatches(got, expected)) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'invalid internal token' } }, 401);
    }
    return next();
  });

  for (const [verb, request] of Object.entries(CONTROLS)) {
    app.post(`/internal/instances/:id/${verb}`, async (c) => {
      const id = c.req.param('id');
      // Malformed uuid would throw a 22P02 out of the uuid cast — same 404 as unknown.
      if (!UUID_RE.test(id)) return c.json({ error: { code: 'RUNTIME_NOT_FOUND', message: 'not found' } }, 404);
      try {
        await request(db, id);
        return c.json({ ok: true });
      } catch (err) {
        if (err instanceof DaoError) {
          const status = err.code === 'RUNTIME_NOT_FOUND' ? 404 : 409;
          return c.json({ error: { code: err.code, message: err.message || err.code } }, status);
        }
        throw err;
      }
    });
  }

  // Force-release (spec §3): releaseUserOnSignOut's exact SET clause (app.ts:37-47), scoped to
  // ONE assignment and WITHOUT the claimant predicate — that is the entire difference between
  // a self-release and a commander's force-release. The notify pair is load-bearing: pg_notify
  // reaches every replica's LISTEN (index.ts), hub covers THIS process's SSE clients directly.
  app.post('/internal/assignments/:id/force-release', async (c) => {
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) return c.json({ error: { code: 'ASSIGNMENT_NOT_FOUND', message: 'not found' } }, 404);
    const [existing] = await db.select({ id: instanceAssignment.id })
      .from(instanceAssignment).where(eq(instanceAssignment.id, id));
    if (!existing) return c.json({ error: { code: 'ASSIGNMENT_NOT_FOUND', message: 'assignment not found' } }, 404);

    const releasedWc = await db.transaction(async (tx) => {
      const updated = await tx.update(instanceAssignment)
        .set({
          status: 'offered', assignedUserId: null, claimedAt: null, resolvedRoleId: null,
          preferredUserId: null, dispatchPolicy: null, dispatchReason: null,
          // D13 (spec 2026-08-17): SET expressions read the OLD tuple, so this captures the
          // evicted claimant in the same UPDATE. The sweep never claims a row back to them.
          releasedFromUserId: sql`${instanceAssignment.assignedUserId}`,
        })
        .where(and(eq(instanceAssignment.id, id), eq(instanceAssignment.status, 'claimed')))
        .returning({ workCenterId: instanceAssignment.workCenterId });
      if (updated.length === 0) return null;
      await tx.execute(sql`SELECT pg_notify(${OPERATOR_CHANGE_CHANNEL}, ${updated[0].workCenterId})`);
      return updated[0].workCenterId;
    });
    if (!releasedWc) return c.json({ error: { code: 'RUNTIME_INVALID_STATE', message: 'assignment is not claimed' } }, 409);
    hub?.notifyWorkCenter(releasedWc);
    // D14b: same post-release sweep as the operator route — a freed step may have a different
    // sole online candidate right now; the D13 marker blocks a bounce to the evicted claimant.
    if (await sweepSoleCandidateClaims(db, releasedWc, deps.now)) {
      await db.execute(sql`SELECT pg_notify(${OPERATOR_CHANGE_CHANNEL}, ${releasedWc})`);
      hub?.notifyWorkCenter(releasedWc);
    }
    return c.json({ ok: true });
  });

  // Commander assign (spec 2026-08-27 §4.6): consume an OFFER for a chosen user. Assigning
  // over a live claim is deliberately impossible — revoke (force-release) first, then assign;
  // a silent steal would hide the eviction from the previous claimant. Eligibility is
  // re-checked HERE at write time (WC membership + role intersection against the step's
  // allowed roles) — the CM candidates list is advisory only. Presence is NOT required:
  // assigning to an away/offline member is a legitimate commander override. Audit:
  // dispatchReason 'commander_assign' (acting-user trace entries arrive with the Phase-2
  // trace machinery — spec §8 refinement).
  app.post('/internal/assignments/:id/assign', async (c) => {
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) return c.json({ error: { code: 'ASSIGNMENT_NOT_FOUND', message: 'not found' } }, 404);
    const body = (await c.req.json().catch(() => null)) as { userId?: unknown } | null;
    const userId = typeof body?.userId === 'string' ? body.userId : '';
    if (!UUID_RE.test(userId)) return c.json({ error: { code: 'VALIDATION', message: 'userId (uuid) required' } }, 400);

    const [row] = await db.select({
      a: instanceAssignment,
      nodeOid: stepInstance.nodeOid,
      workflowId: workflowInstance.workflowId, specJsonb: workflowInstance.specJsonb,
    }).from(instanceAssignment)
      .innerJoin(stepInstance, eq(instanceAssignment.stepInstanceId, stepInstance.id))
      .innerJoin(workflowInstance, eq(stepInstance.workflowInstanceId, workflowInstance.id))
      .where(eq(instanceAssignment.id, id));
    if (!row) return c.json({ error: { code: 'ASSIGNMENT_NOT_FOUND', message: 'assignment not found' } }, 404);

    if (!(await requireWcMember(db, userId, row.a.workCenterId))) {
      return c.json({ error: { code: 'USER_NOT_ELIGIBLE', message: 'user is not a member of this work center' } }, 409);
    }
    // Same live re-check the operator claim route runs (app.ts): a role revoked after the
    // offer loses at assign too.
    const allowed = await resolveStepAllowedRoles(db, {
      workflowId: row.workflowId, specJsonb: row.specJsonb, recipeNodeOid: row.nodeOid,
    });
    let resolvedRoleId: string | null = null;
    if (allowed.length > 0) {
      const mine = await db.select({ roleId: workCenterUserRole.roleId }).from(workCenterUserRole)
        .where(and(
          eq(workCenterUserRole.workCenterId, row.a.workCenterId),
          eq(workCenterUserRole.userId, userId),
          inArray(workCenterUserRole.roleId, allowed),
        ));
      if (mine.length === 0) {
        return c.json({ error: { code: 'USER_NOT_ELIGIBLE', message: 'user holds no allowed role for this step' } }, 409);
      }
      resolvedRoleId = mine[0].roleId;
    }

    const won = await db.transaction(async (tx) => {
      const updated = await tx.update(instanceAssignment)
        .set({
          status: 'claimed', assignedUserId: userId, claimedAt: deps.now(), resolvedRoleId,
          releasedFromUserId: null, dispatchReason: 'commander_assign',
        })
        .where(and(eq(instanceAssignment.id, id), eq(instanceAssignment.status, 'offered')))
        .returning({ id: instanceAssignment.id });
      if (updated.length === 0) return false;
      await tx.execute(sql`SELECT pg_notify(${OPERATOR_CHANGE_CHANNEL}, ${row.a.workCenterId})`);
      return true;
    });
    if (!won) return c.json({ error: { code: 'ASSIGNMENT_NOT_OFFERED', message: 'assignment is not an open offer' } }, 409);
    hub?.notifyWorkCenter(row.a.workCenterId);
    return c.json({ ok: true });
  });

  // Phase 4a (spec §7.1): operator verbs on the shared work-center registry and on an instance's
  // own resources / values. Same token gate, same envelope. Verb literals are route segments
  // (one registration per verb, like CONTROLS above) so an unknown verb is simply no route.
  const verbStatus = (code: string): 400 | 403 | 404 | 409 =>
    (code === 'VALIDATION' ? 400 : code === 'NOT_FORCEABLE' ? 403 : code.endsWith('_NOT_FOUND') ? 404 : 409);
  const verbErrorResponse = (c: any, err: unknown) => {
    if (err instanceof VerbError) return c.json({ error: { code: err.code, message: err.message } }, verbStatus(err.code));
    throw err;
  };
  const readBody = async (c: any): Promise<Record<string, unknown>> => ((await c.req.json().catch(() => null)) as Record<string, unknown> | null) ?? {};
  const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
  const actorOf = (b: Record<string, unknown>): string | null => (typeof b.actorUserId === 'string' && UUID_RE.test(b.actorUserId) ? b.actorUserId : null);
  const posInt = (v: unknown): number | undefined | null => (v === undefined ? undefined : Number.isInteger(v) && (v as number) > 0 ? (v as number) : null);
  const validation = (c: any, message: string) => c.json({ error: { code: 'VALIDATION', message } }, 400);

  for (const verb of RESOURCE_VERBS as readonly ResourceVerb[]) {
    app.post(`/internal/work-centers/:wcId/resources/${verb}`, async (c) => {
      const wcId = c.req.param('wcId');
      if (!UUID_RE.test(wcId)) return c.json({ error: { code: 'WORK_CENTER_NOT_FOUND', message: 'not found' } }, 404);
      const b = await readBody(c);
      const name = str(b.name); const actorUserId = actorOf(b);
      if (!name || !actorUserId) return validation(c, 'name and actorUserId (uuid) are required');
      const holderId = posInt(b.holderId), waiterId = posInt(b.waiterId), amount = posInt(b.amount);
      if (holderId === null || waiterId === null || amount === null) return validation(c, 'holderId, waiterId and amount must be positive integers');
      const poolName = str(b.poolName) ?? undefined;
      try {
        const r = await runWorkCenterResourceVerb(db, deps, hub, { verb, name, holderId, waiterId, amount, poolName, workCenterId: wcId, actorUserId });
        return c.json({ ok: true, summary: r.summary, affectedInstanceIds: r.affectedInstanceIds });
      } catch (err) { return verbErrorResponse(c, err); }
    });

    app.post(`/internal/instances/:id/resources/${verb}`, async (c) => {
      const id = c.req.param('id');
      if (!UUID_RE.test(id)) return c.json({ error: { code: 'RUNTIME_NOT_FOUND', message: 'not found' } }, 404);
      const b = await readBody(c);
      const resourceKey = str(b.resourceKey); const actorUserId = actorOf(b);
      if (!resourceKey || !actorUserId) return validation(c, 'resourceKey and actorUserId (uuid) are required');
      const holderId = posInt(b.holderId), amount = posInt(b.amount);
      if (holderId === null || amount === null) return validation(c, 'holderId and amount must be positive integers');
      // D16: an environment waiter is a row id; a workflow-tier waiter is the queued step's oid.
      const waiterId = typeof b.waiterId === 'number' ? posInt(b.waiterId) : undefined;
      if (waiterId === null) return validation(c, 'waiterId must be a positive integer or a step oid');
      const waiterStepOid = typeof b.waiterId === 'string' ? b.waiterId : undefined;
      const poolName = str(b.poolName) ?? undefined;
      try {
        const r = await runInstanceResourceVerb(db, deps, hub, {
          verb, name: resourceKey, resourceKey, holderId, waiterId, waiterStepOid, amount, poolName, instanceId: id, actorUserId,
        });
        return c.json({ ok: true, summary: r.summary, affectedInstanceIds: r.affectedInstanceIds });
      } catch (err) { return verbErrorResponse(c, err); }
    });
  }

  app.post('/internal/work-centers/:wcId/value-properties', async (c) => {
    const wcId = c.req.param('wcId');
    if (!UUID_RE.test(wcId)) return c.json({ error: { code: 'WORK_CENTER_NOT_FOUND', message: 'not found' } }, 404);
    const b = await readBody(c);
    const propertyName = str(b.propertyName); const entryName = str(b.entryName); const actorUserId = actorOf(b);
    if (!propertyName || !entryName || typeof b.value !== 'string' || !actorUserId) return validation(c, 'propertyName, entryName, value (string) and actorUserId (uuid) are required');
    try {
      const r = await setWorkCenterValueProperty(db, deps, hub, { workCenterId: wcId, propertyName, entryName, value: b.value, actorUserId });
      return c.json({ ok: true, summary: r.summary });
    } catch (err) { return verbErrorResponse(c, err); }
  });

  app.post('/internal/instances/:id/value-properties', async (c) => {
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) return c.json({ error: { code: 'RUNTIME_NOT_FOUND', message: 'not found' } }, 404);
    const b = await readBody(c);
    const key = str(b.key); const actorUserId = actorOf(b);
    if (!key || typeof b.value !== 'string' || !actorUserId) return validation(c, 'key, value (string) and actorUserId (uuid) are required');
    const specOid = str(b.specOid) ?? undefined;
    try {
      const r = await setInstanceValueProperty(db, deps, hub, { instanceId: id, specOid, key, value: b.value, actorUserId });
      return c.json({ ok: true, summary: r.summary });
    } catch (err) { return verbErrorResponse(c, err); }
  });

  // Spec 2026-10-13 §5.1/§5.2: a commander forces a waiting gate. The CM route has already
  // checked Mission System Commander rights and that a reason was given.
  app.post('/internal/instances/:id/steps/:stepInstanceId/force-complete', async (c) => {
    const id = c.req.param('id');
    const stepInstanceId = c.req.param('stepInstanceId');
    if (!UUID_RE.test(id)) return c.json({ error: { code: 'RUNTIME_NOT_FOUND', message: 'not found' } }, 404);
    if (!UUID_RE.test(stepInstanceId)) return c.json({ error: { code: 'STEP_NOT_FOUND', message: 'not found' } }, 404);
    const b = await readBody(c);
    const actorUserId = actorOf(b);
    if (!actorUserId) return validation(c, 'actorUserId (uuid) is required');
    const reason = typeof b.reason === 'string' ? b.reason.slice(0, 500) : null;
    try {
      const r = await forceCompleteStep(db, deps, hub, { instanceId: id, stepInstanceId, actorUserId, reason, source: 'commander' });
      return c.json({ ok: true, summary: r.summary });
    } catch (err) { return verbErrorResponse(c, err); }
  });

  return app;
}
