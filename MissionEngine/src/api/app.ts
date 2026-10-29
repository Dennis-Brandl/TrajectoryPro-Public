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
import { streamSSE } from 'hono/streaming';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { createHash, randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  appUser, workCenter, workCenterUser, workCenterUserRole, operatorPresence, instanceAssignment,
  stepInstance, workflowInstance, workflowImage,
} from 'mission-control-db/src/db/schema/index';
import { buildInbox, findStepDef } from 'mission-control-db/src/runtime/inbox';
import { listOperatorWorkCenters } from 'mission-control-db/src/runtime/operator-work-centers';
import { readSiteTheme } from 'mission-control-db/src/dao/pilot-theme-store';
import { readThemeChain } from 'mission-control-db/src/dao/pilot-theme-chain';
import { resolveTheme, safeResolve, themePayload } from 'mission-control-db/src/dao/pilot-theme';
import { readBrandAsset, brandAssetHeaders } from 'mission-control-db/src/dao/brand-assets';
import { resolveStepAllowedRoles, sweepSoleCandidateClaims } from 'mission-control-db/src/runtime/assignments';
import {
  listActiveRuntimeWorkflowsForOperator, getRuntimeWorkflowLiveStates, workCenterIdForInstance,
} from 'mission-control-db/src/dao/runtime-workflows';
import { getRuntimeWorkflowDiagram } from 'mission-control-db/src/dao/workflow-diagram';
import { insertStepSignature } from 'mission-control-db/src/dao/step-signatures';
import type { Db } from '../db.js';
import type { EngineDeps } from '../config.js';
import type { EngineAuth } from './auth.js';
import { OPERATOR_CHANGE_CHANNEL } from '../core/reconcile.js';
import { submitUserAction, EngineError } from '../core/submit.js';
import { canonicalStepType } from '../core/step-handlers.js';
import { forceCompleteStep } from '../core/force-complete.js';
import { VerbError } from '../core/registry-verbs.js';
import { findESignatureBlock, verifySignature, SignatureError, SIGNATURE_HTTP_STATUS } from '../core/esignature.js';
import type { UserAction } from '../spec/types.js';
import { OperatorEventHub } from './events.js';
import { clientIpMiddleware, parseTrustedProxies } from './client-ip.js';
import { isUserDisabled } from 'mission-control-db/src/dao/account-status';

type ApiEnv = { Variables: { userId: string; sessionId: string } };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function requireWcMember(db: Db, userId: string, workCenterId: string): Promise<boolean> {
  // A non-uuid would fail the uuid cast in Postgres (a 500); it names no work center.
  if (!UUID_RE.test(workCenterId)) return false;
  const [row] = await db.select({ userId: workCenterUser.userId }).from(workCenterUser)
    .where(and(eq(workCenterUser.userId, userId), eq(workCenterUser.workCenterId, workCenterId)));
  return row !== undefined;
}

async function notify(db: Db, wcId: string): Promise<void> {
  await db.execute(sql`SELECT pg_notify(${OPERATOR_CHANGE_CHANNEL}, ${wcId})`);
}

/** Shared by /api/logout and the /api/auth/sign-out intercept below (spec F7): releases every
 *  claim the user holds, ends THIS session's presence row, and NOTIFYs each affected work
 *  center. Kept as one function so the two sign-out paths cannot drift apart. */
async function releaseUserOnSignOut(db: Db, hub: OperatorEventHub | null, deps: EngineDeps, userId: string, sessionId: string): Promise<void> {
  // preferredUserId + dispatch audit are cleared too (review fix): a released row is a plain
  // offer again — leaving them would re-suggest an auto-claimed step to the very operator it
  // was just taken from and keep auditing a now-manual offer as 'auto_claim_chain'. The
  // release route and internal.ts force-release use this exact SET clause (including the D13
  // released_from_user_id stamp) — keep in lockstep.
  const [pres] = await db.select({ wcId: operatorPresence.attendingWorkCenterId })
    .from(operatorPresence).where(eq(operatorPresence.sessionId, sessionId));
  const affected = await db.update(instanceAssignment)
    .set({
      status: 'offered', assignedUserId: null, claimedAt: null, resolvedRoleId: null,
      preferredUserId: null, dispatchPolicy: null, dispatchReason: null,
      // D13 (spec 2026-08-17): SET expressions read the OLD tuple, so this captures the
      // evicted claimant in the same UPDATE. The sweep never claims a row back to them.
      releasedFromUserId: sql`${instanceAssignment.assignedUserId}`,
    })
    .where(and(eq(instanceAssignment.assignedUserId, userId), eq(instanceAssignment.status, 'claimed')))
    .returning({ workCenterId: instanceAssignment.workCenterId });
  await db.delete(operatorPresence).where(eq(operatorPresence.sessionId, sessionId));
  // Sweep every work center whose offer or candidate pool changed (D14b): the WCs that got
  // freed offers, plus the WC this session was attending (its pool just shrank).
  const wcIds = new Set(affected.map((a) => a.workCenterId));
  if (pres) wcIds.add(pres.wcId);
  for (const wcId of wcIds) {
    await notify(db, wcId);
    hub?.notifyWorkCenter(wcId);
    if (await sweepSoleCandidateClaims(db, wcId, deps.now)) {
      await notify(db, wcId);
      hub?.notifyWorkCenter(wcId);
    }
  }
}

export function createApiApp(db: Db, deps: EngineDeps, auth: EngineAuth, hub: OperatorEventHub | null): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();

  // Sole-candidate sweep (spec 2026-08-17 D14b): run after a presence transition or release
  // commits; NOTIFY only when something actually claimed.
  async function sweepAndNotify(workCenterId: string): Promise<void> {
    if (await sweepSoleCandidateClaims(db, workCenterId, deps.now)) {
      await notify(db, workCenterId);
      hub?.notifyWorkCenter(workCenterId);
    }
  }

  // Intercept better-auth's OWN sign-out endpoint — what a stock better-auth client calls —
  // BEFORE the generic /api/auth/* passthrough below (registered first so it wins the route
  // match regardless of router internals). Without this, a client that calls sign-out directly
  // (rather than the bespoke /api/logout) ends the session with no claim release or presence
  // cleanup, and the user's claims strand until phase 6's force-release. Resolve the session
  // BEFORE delegating: auth.handler's sign-out invalidates it, so getSession after would find
  // nothing to release against.
  // Before any /api/auth/* route: better-auth's rate limit keys on the IP this sets.
  app.use('/api/auth/*', clientIpMiddleware(parseTrustedProxies(process.env.TRUSTED_PROXIES)));

  app.post('/api/auth/sign-out', async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (session) await releaseUserOnSignOut(db, hub, deps, session.user.id, session.session.id);
    return auth.handler(c.req.raw);
  });

  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

  // Spec 2026-10-09 §13 / R5: the site theme is public, so the login screen is branded; a
  // work center's theme is members-only. Registered BEFORE the session gate below so the
  // site request never reaches it. The ETag is the global theme rev (any site or work-center
  // write bumps it) PLUS a hash of the response: a deploy that changes the payload for the
  // same rev (new defaults, P3's layers) must not 304 a Pilot into keeping stale CSS (final
  // review). It also rides in the body, so the Pilot sends back exactly what it cached. With
  // ?workCenterId the work center's ancestor chain is merged on top (spec §8.2) through
  // safeResolve, so an override a later change broke never ships unreadable (§11).
  app.get('/api/theme', async (c) => {
    const workCenterId = c.req.query('workCenterId');
    if (workCenterId !== undefined) {
      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      if (!session) return c.json({ error: 'unauthenticated' }, 401);
      if (!UUID_RE.test(workCenterId) || !(await requireWcMember(db, session.user.id, workCenterId))) {
        return c.json({ error: 'not a member of this work center' }, 403);
      }
    }
    const { rev, site } = await readSiteTheme(db);
    let resolved = resolveTheme([site]);
    if (workCenterId !== undefined) {
      const chain = await readThemeChain(db, workCenterId);
      resolved = safeResolve(site, (chain ?? []).map((l) => l.theme));
    }
    const payload = themePayload(rev, resolved);
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
    const etag = `"${rev}-${hash}"`;
    c.header('ETag', etag);
    c.header('Cache-Control', 'no-cache');
    if (c.req.header('if-none-match') === etag) return c.body(null, 304);
    return c.json({ ...payload, etag });
  });

  // Spec 2026-10-09 §12 / R5: logos are public — the login screen shows the site logo — and
  // immutable, because the id is the content hash of the bytes. Before the session gate.
  app.get('/api/brand/:id', async (c) => {
    const asset = await readBrandAsset(db, c.req.param('id'));
    if (!asset) return c.json({ error: 'not found' }, 404);
    return c.body(new Uint8Array(asset.data), 200, brandAssetHeaders(asset.mime));
  });

  // Session gate for everything else under /api/.
  app.use('/api/*', async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'unauthenticated' }, 401);
    // A session row can predate the account being disabled; the status column is authoritative.
    if (await isUserDisabled(db, session.user.id)) return c.json({ error: 'unauthenticated' }, 401);
    c.set('userId', session.user.id);
    c.set('sessionId', session.session.id);
    return next();
  });

  app.get('/api/me', async (c) => {
    const userId = c.get('userId');
    // No role list (spec 2026-09-06 D9): roles are per work center and nothing rendered it.
    // loginName is what the e-signature element prefills.
    const [me] = await db.select({ id: appUser.id, email: appUser.email, displayName: appUser.displayName, loginName: appUser.loginName })
      .from(appUser).where(eq(appUser.id, userId));
    return c.json(me);
  });

  // Spec 2026-10-09 §5.5: the picker's cards — path from the root and the open-task count
  // the inbox there would show (same visibility rule as buildInbox).
  app.get('/api/work-centers', async (c) => c.json(await listOperatorWorkCenters(db, c.get('userId'))));

  app.get('/api/inbox', async (c) => {
    const workCenterId = c.req.query('workCenterId');
    if (!workCenterId) return c.json({ error: 'workCenterId is required' }, 400);
    if (!UUID_RE.test(workCenterId)) return c.json({ error: 'invalid work center id' }, 400);
    if (!(await requireWcMember(db, c.get('userId'), workCenterId))) return c.json({ error: 'not a member of this work center' }, 403);
    return c.json(await buildInbox(db, c.get('userId'), workCenterId));
  });

  // ── SSE: full-snapshot inbox push (Task 11, spec F8) ──
  app.get('/api/events', async (c) => {
    const workCenterId = c.req.query('workCenterId');
    if (!workCenterId) return c.json({ error: 'workCenterId is required' }, 400);
    if (!UUID_RE.test(workCenterId)) return c.json({ error: 'invalid work center id' }, 400);
    const userId = c.get('userId');
    if (!(await requireWcMember(db, userId, workCenterId))) return c.json({ error: 'not a member of this work center' }, 403);
    if (!hub || !(hub instanceof OperatorEventHub)) return c.json({ error: 'events unavailable' }, 503);
    const key = `${c.get('sessionId')}:${workCenterId}:${randomUUID()}`;
    return streamSSE(c, async (stream) => {
      // Unregister on every exit path, and attach onAbort before any await: a client that
      // disconnects during the first snapshot must not leave a dead session behind.
      stream.onAbort(() => hub.unregister(key));
      hub.register(key, {
        userId,
        workCenterId,
        send: (snap) => void stream.writeSSE({ event: 'inbox', data: JSON.stringify(snap) }),
        sendTheme: (rev) => void stream.writeSSE({ event: 'theme', data: JSON.stringify({ rev }) }),
      });
      try {
        await stream.writeSSE({ event: 'inbox', data: JSON.stringify(await buildInbox(db, userId, workCenterId)) });
        // Keep-alive comment every 25s until aborted.
        while (!stream.aborted) { await stream.sleep(25_000); await stream.writeSSE({ event: 'ping', data: '' }); }
      } finally {
        hub.unregister(key);
      }
    });
  });

  // ── Form-document image bytes (user-testing fix: blank image boxes in the Pilot) ──
  // An image block's `src` is a bare filename; the bytes live in workflow_image, extracted
  // from the .WFmasterX's images/ entries at load (mission-control-db ingest). Served per
  // INSTANCE because that's the id the inbox payload carries — and the instance's workflow
  // row cannot be deleted while the instance exists (deleteWorkflow refuses), so a live
  // task's images cannot vanish under it. Membership-gated like /api/inbox: recipe content,
  // scoped to the work center's operators.
  app.get('/api/instances/:instanceId/images/:filename', async (c) => {
    const instanceId = c.req.param('instanceId');
    // <img> URLs are assembled client-side — a malformed id must 404, not 500 on the uuid cast.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(instanceId)) {
      return c.json({ error: 'not found' }, 404);
    }
    const [inst] = await db.select({ workflowId: workflowInstance.workflowId, workCenterId: workflowInstance.workCenterId })
      .from(workflowInstance).where(eq(workflowInstance.id, instanceId));
    if (!inst) return c.json({ error: 'not found' }, 404);
    if (!(await requireWcMember(db, c.get('userId'), inst.workCenterId))) return c.json({ error: 'not a member of this work center' }, 403);
    const [img] = await db.select({ mimeType: workflowImage.mimeType, dataBase64: workflowImage.dataBase64 })
      .from(workflowImage)
      .where(and(eq(workflowImage.workflowId, inst.workflowId), eq(workflowImage.filename, c.req.param('filename'))));
    if (!img) return c.json({ error: 'not found' }, 404);
    // Bytes behind a given URL only change when a steward re-loads the package — a short
    // private cache keeps repeat task opens from re-downloading every photo.
    const bytes = Buffer.from(img.dataBase64, 'base64');
    return c.body(new Uint8Array(bytes), 200, {
      'Content-Type': img.mimeType,
      'Cache-Control': 'private, max-age=3600',
    });
  });

  // ── Pilot Workflows tab (spec 2026-08-19): three read-only projections. Auth =
  //    the images-route pattern: uuid-shape check before the cast (404/400, never a
  //    500), instance → work_center_id → requireWcMember. no-store: the Pilot
  //    polls these; a cached copy is exactly the stale-tab bug class Fix 12 killed. ──
  app.get('/api/work-centers/:wcId/runtime-workflows', async (c) => {
    const wcId = c.req.param('wcId');
    if (!UUID_RE.test(wcId)) return c.json({ error: 'invalid work center id' }, 400);
    if (!(await requireWcMember(db, c.get('userId'), wcId))) return c.json({ error: 'not a member of this work center' }, 403);
    c.header('Cache-Control', 'no-store');
    return c.json(await listActiveRuntimeWorkflowsForOperator(db, wcId, c.get('userId')));
  });

  app.get('/api/runtime-workflows/:id/diagram', async (c) => {
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) return c.json({ error: 'not found' }, 404);
    const wcId = await workCenterIdForInstance(db, id);
    if (!wcId) return c.json({ error: 'not found' }, 404);
    if (!(await requireWcMember(db, c.get('userId'), wcId))) return c.json({ error: 'not a member of this work center' }, 403);
    const diagram = await getRuntimeWorkflowDiagram(db, id);
    if (!diagram) return c.json({ error: 'not found' }, 404);
    c.header('Cache-Control', 'no-store');
    return c.json(diagram);
  });

  app.get('/api/runtime-workflows/:id/live-states', async (c) => {
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) return c.json({ error: 'not found' }, 404);
    const wcId = await workCenterIdForInstance(db, id);
    if (!wcId) return c.json({ error: 'not found' }, 404);
    if (!(await requireWcMember(db, c.get('userId'), wcId))) return c.json({ error: 'not a member of this work center' }, 403);
    const live = await getRuntimeWorkflowLiveStates(db, id, c.get('userId'));
    if (!live) return c.json({ error: 'not found' }, 404);
    c.header('Cache-Control', 'no-store');
    return c.json(live);
  });

  // Spec 2026-10-13 §5.3: an operator's "Continue now" on a waiting TIMED gate. Any member of
  // the instance's work center; the engine (not the Pilot UI) refuses a plain condition gate.
  app.post('/api/runtime-workflows/:id/steps/:stepInstanceId/continue', async (c) => {
    const id = c.req.param('id');
    const stepInstanceId = c.req.param('stepInstanceId');
    if (!UUID_RE.test(id) || !UUID_RE.test(stepInstanceId)) return c.json({ error: 'not found' }, 404);
    const wcId = await workCenterIdForInstance(db, id);
    if (!wcId) return c.json({ error: 'not found' }, 404);
    if (!(await requireWcMember(db, c.get('userId'), wcId))) return c.json({ error: 'not a member of this work center' }, 403);
    const body = (await c.req.json().catch(() => null)) as { reason?: unknown } | null;
    const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 500) : null;
    try {
      await forceCompleteStep(db, deps, hub, { instanceId: id, stepInstanceId, actorUserId: c.get('userId'), reason, source: 'pilot' });
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof VerbError) {
        const status = err.code === 'NOT_FORCEABLE' ? 403 : err.code.endsWith('_NOT_FOUND') ? 404 : 409;
        return c.json({ error: err.message, code: err.code }, status);
      }
      throw err;
    }
  });

  app.post('/api/presence', async (c) => {
    const userId = c.get('userId'); const sessionId = c.get('sessionId');
    const body = await c.req.json().catch(() => null) as { workCenterId?: string } | null;
    const workCenterId = typeof body?.workCenterId === 'string' ? body.workCenterId : undefined;
    if (!workCenterId) return c.json({ error: 'workCenterId is required' }, 400);
    if (!UUID_RE.test(workCenterId)) return c.json({ error: 'invalid work center id' }, 400);
    if (!(await requireWcMember(db, userId, workCenterId))) return c.json({ error: 'not a member of this work center' }, 403);
    // Pre-delete anything that could violate either unique index (session_uq, user_wc_uq),
    // then insert fresh — never catch a 23505 inside a transaction (poisons it).
    const displaced = await db.transaction(async (tx) => {
      const gone = await tx.delete(operatorPresence).where(and(
        eq(operatorPresence.userId, userId),
        sql`(${operatorPresence.sessionId} = ${sessionId} OR ${operatorPresence.attendingWorkCenterId} = ${workCenterId})`,
      )).returning({ wcId: operatorPresence.attendingWorkCenterId });
      await tx.insert(operatorPresence).values({
        userId, attendingWorkCenterId: workCenterId, sessionId,
        status: 'online', lastHeartbeatAt: deps.now(),
      });
      return gone;
    });
    // Arrival sweep (D14b) — the new WC gained a candidate; any displaced WC lost one.
    const wcIds = new Set<string>([workCenterId, ...displaced.map((d) => d.wcId)]);
    for (const wcId of wcIds) await sweepAndNotify(wcId);
    return c.json({ ok: true });
  });

  app.post('/api/presence/heartbeat', async (c) => {
    const body = await c.req.json().catch(() => null) as { status?: 'away' | 'back' } | null;
    const status = body?.status === 'away' ? 'away' : body?.status === 'back' ? 'online' : undefined;
    const [before] = await db.select({ wcId: operatorPresence.attendingWorkCenterId, status: operatorPresence.status })
      .from(operatorPresence).where(eq(operatorPresence.sessionId, c.get('sessionId')));
    await db.update(operatorPresence)
      .set({ lastHeartbeatAt: deps.now(), ...(status ? { status } : {}) })
      .where(eq(operatorPresence.sessionId, c.get('sessionId')));
    // D14b: 'away' can make the REMAINING operator sole; 'back' makes THIS one a candidate
    // again. A status-free keep-alive is not a transition and never sweeps.
    if (before && status && status !== before.status) await sweepAndNotify(before.wcId);
    return c.json({ ok: true });
  });

  app.delete('/api/presence', async (c) => {
    // ?workCenterId=<id> leaves only that work center: a late DELETE for the one the
    // operator just switched away from must not remove the row POST wrote for the new one.
    // Without it (sign-out paths) the session's presence goes, whichever work center it is at.
    const leaving = c.req.query('workCenterId');
    if (leaving && !UUID_RE.test(leaving)) return c.json({ error: 'invalid work center id' }, 400);
    const where = leaving
      ? and(eq(operatorPresence.sessionId, c.get('sessionId')), eq(operatorPresence.attendingWorkCenterId, leaving))
      : eq(operatorPresence.sessionId, c.get('sessionId'));
    const [before] = await db.select({ wcId: operatorPresence.attendingWorkCenterId })
      .from(operatorPresence).where(where);
    await db.delete(operatorPresence).where(where);
    if (before) await sweepAndNotify(before.wcId);   // D14b: this WC just lost a candidate
    return c.json({ ok: true });
  });

  // Deliberate Logout releases the user's claims (spec F7) and ends this session's presence,
  // THEN signs out. AWAY/tab-close never comes through here, so claims survive those.
  app.post('/api/logout', async (c) => {
    await releaseUserOnSignOut(db, hub, deps, c.get('userId'), c.get('sessionId'));
    return auth.api.signOut({ headers: c.req.raw.headers, asResponse: true });
  });

  // ── Claim / release / submit (Task 10, spec §4.3) ──

  async function loadAssignment(id: string) {
    // Malformed ids are "not found" (404), never a 500 from the uuid cast.
    if (!UUID_RE.test(id)) return undefined;
    const [row] = await db.select({
      a: instanceAssignment, step: stepInstance,
      instanceId: workflowInstance.id, workflowId: workflowInstance.workflowId,
      specJsonb: workflowInstance.specJsonb,
      runtimeNumber: workflowInstance.runtimeNumber, runtimeLabel: workflowInstance.runtimeLabel,
      workCenterName: workCenter.name,
    }).from(instanceAssignment)
      .innerJoin(stepInstance, eq(instanceAssignment.stepInstanceId, stepInstance.id))
      .innerJoin(workflowInstance, eq(stepInstance.workflowInstanceId, workflowInstance.id))
      .innerJoin(workCenter, eq(workCenter.id, instanceAssignment.workCenterId))
      .where(eq(instanceAssignment.id, id));
    return row;
  }

  app.post('/api/assignments/:id/claim', async (c) => {
    const userId = c.get('userId');
    const row = await loadAssignment(c.req.param('id'));
    if (!row) return c.json({ error: 'not found' }, 404);
    // loadAssignment doesn't filter on the step's pause state — an offer whose step is PAUSED
    // stays claimable by id (it's only hidden from inbox listings). Deliberate symmetry with
    // claims surviving pause: pausing a step must not strand or invalidate work already in
    // flight toward it.
    if (!(await requireWcMember(db, userId, row.a.workCenterId))) return c.json({ error: 'not a member of this work center' }, 403);

    // Live eligibility re-check (spec §4.3): a role revoked after the offer loses at claim.
    const allowed = await resolveStepAllowedRoles(db, {
      workflowId: row.workflowId, specJsonb: row.specJsonb, recipeNodeOid: row.step.nodeOid,
    });
    let resolvedRoleId: string | null = null;
    if (allowed.length > 0) {
      const mine = await db.select({ roleId: workCenterUserRole.roleId }).from(workCenterUserRole)
        .where(and(
          eq(workCenterUserRole.workCenterId, row.a.workCenterId),
          eq(workCenterUserRole.userId, userId),
          inArray(workCenterUserRole.roleId, allowed),
        ));
      if (mine.length === 0) return c.json({ error: 'no matching role' }, 403);
      resolvedRoleId = mine[0].roleId;
    }

    const won = await db.transaction(async (tx) => {
      const updated = await tx.update(instanceAssignment)
        .set({ status: 'claimed', assignedUserId: userId, claimedAt: deps.now(), resolvedRoleId, releasedFromUserId: null })
        .where(and(eq(instanceAssignment.id, row.a.id), eq(instanceAssignment.status, 'offered')))
        .returning({ id: instanceAssignment.id });
      if (updated.length === 0) return false;
      await tx.execute(sql`SELECT pg_notify(${OPERATOR_CHANGE_CHANNEL}, ${row.a.workCenterId})`);
      return true;
    });
    if (!won) return c.json({ error: 'already claimed' }, 409);
    hub?.notifyWorkCenter(row.a.workCenterId);
    return c.json({ ok: true });
  });

  app.post('/api/assignments/:id/release', async (c) => {
    const userId = c.get('userId');
    const row = await loadAssignment(c.req.param('id'));
    if (!row) return c.json({ error: 'not found' }, 404);
    // Claimant-scoped, no requireWcMember re-check: a user removed from the work center mid-claim
    // may still release the claim they already hold (spec: revocation binds at claim, not after).
    const won = await db.transaction(async (tx) => {
      const updated = await tx.update(instanceAssignment)
        .set({
          status: 'offered', assignedUserId: null, claimedAt: null, resolvedRoleId: null,
          preferredUserId: null, dispatchPolicy: null, dispatchReason: null,
          // D13 (spec 2026-08-17): SET expressions read the OLD tuple, so this captures the
          // evicted claimant in the same UPDATE. The sweep never claims a row back to them.
          releasedFromUserId: sql`${instanceAssignment.assignedUserId}`,
        })
        .where(and(
          eq(instanceAssignment.id, row.a.id),
          eq(instanceAssignment.status, 'claimed'),
          eq(instanceAssignment.assignedUserId, userId),
        )).returning({ id: instanceAssignment.id });
      if (updated.length === 0) return false;
      await tx.execute(sql`SELECT pg_notify(${OPERATOR_CHANGE_CHANNEL}, ${row.a.workCenterId})`);
      return true;
    });
    if (!won) return c.json({ error: 'not your claim' }, 409);
    hub?.notifyWorkCenter(row.a.workCenterId);
    // D14b: a freed step may already have a DIFFERENT sole online candidate; the D13 marker
    // (stamped in the transaction above) keeps it from bouncing straight back to the releaser.
    await sweepAndNotify(row.a.workCenterId);
    return c.json({ ok: true });
  });

  app.post('/api/assignments/:id/submit', async (c) => {
    const userId = c.get('userId');
    const row = await loadAssignment(c.req.param('id'));
    if (!row) return c.json({ error: 'not found' }, 404);
    // Claimant-scoped, no requireWcMember re-check: a user removed from the work center mid-claim
    // may still finish the claim they already hold (spec: revocation binds at claim, not after).
    // Identity is enforced downstream by submitUserAction/submitCore via { assignmentId, userId }.
    // Review fix (fix round 1, finding 1): 'complete' now carries an optional signature too — the
    // gate keys on the resulting action, not on which kind produced it, and {kind:'complete'}
    // reaches submitCore as the same bare submit action as an empty {kind:'submit'} would.
    const body = await c.req.json().catch(() => null) as
      | { kind: 'complete'; signature?: { loginName?: unknown; password?: unknown } }
      | { kind: 'submit'; values?: Record<string, unknown>; signature?: { loginName?: unknown; password?: unknown } }
      | { kind: 'decision'; value: string; values?: Record<string, unknown>; signature?: { loginName?: unknown; password?: unknown } }
      | null;
    if (!body || !['complete', 'submit', 'decision'].includes((body as { kind?: string }).kind ?? '')) {
      return c.json({ error: 'kind must be complete | submit | decision' }, 400);
    }

    // kind <-> step-type pairing (spec §5.3, review fix): a YES_NO step can only be resolved via
    // 'decision' — any other kind never sets button_output, so handleUserAction's YES_NO branch
    // falls through to "every outgoing connection fires" (the same failure mode the button_output
    // fix below closes for the decision path itself). Conversely 'decision' only makes sense
    // against a YES_NO step. `row.step.stepType` is already canonicalStepType'd at write time
    // (transition.ts) — re-applied here defensively rather than trusted blindly.
    const stepType = canonicalStepType(row.step.stepType);
    if (body.kind === 'decision') {
      if (stepType !== 'YES_NO') return c.json({ error: 'kind "decision" is only valid for a YES_NO step' }, 400);
      // Review fix: `value` arrived as an unvalidated string — 'fail'/'pause'/anything else would
      // otherwise reach submitCore as a raw `action.action`, invoking failStep/the pause
      // short-circuit against a step the caller never meant to fail or strand.
      if (body.value !== 'yes' && body.value !== 'no') return c.json({ error: "value must be 'yes' or 'no'" }, 400);
    } else if (stepType === 'YES_NO') {
      return c.json({ error: 'a YES_NO step requires kind "decision"' }, 400);
    }

    // Review fix (fix round 1, finding 2): credential verification and the `failed` audit-row
    // write below must never run for a caller who isn't the claimant — otherwise any
    // authenticated user who can see an assignment id could use this route as a password oracle
    // and write compliance rows against a step they don't hold, stamped with themselves as the
    // operator. submitCore's own FOR UPDATE claim guard (spec §4.3) stays the authoritative,
    // race-safe check for the actual submission; this is the SAME check, same response shape,
    // done early so nothing signature-related runs first.
    if (row.a.status !== 'claimed' || row.a.assignedUserId !== userId) {
      return c.json({ code: 'NOT_CLAIMANT', error: `assignment ${row.a.id} is not held by the caller for step ${row.step.stepOid}` }, 409);
    }

    // Spec 2026-09-06 D5: a signature is required exactly when the frozen step document holds an
    // esignature block, for every kind EXCEPT a YES_NO 'no' decision (review fix, fix round 1,
    // finding 1: gating on body.kind === 'submit' let {"kind":"complete"} — which handleUserAction
    // treats identically to an empty submit — bypass the gate entirely).
    const def = findStepDef(row.specJsonb, row.step.nodeOid, row.step.stepOid);
    const esig = findESignatureBlock(def?.form_document);
    const needsSignature = esig !== null && !(body.kind === 'decision' && body.value === 'no');
    let verifiedSignature: { verified: Awaited<ReturnType<typeof verifySignature>>; workCenterName: string; operatorLoginName: string } | undefined;
    if (needsSignature) {
      const sig = body.signature;
      const loginName = typeof sig?.loginName === 'string' ? sig.loginName.trim() : '';
      const password = typeof sig?.password === 'string' ? sig.password : '';
      if (!loginName || !password.trim()) {
        return c.json({ code: 'SIGNATURE_REQUIRED', error: 'This step requires an e-signature' }, 400);
      }
      const [operator] = await db.select({ loginName: appUser.loginName }).from(appUser).where(eq(appUser.id, userId));
      const stepName = typeof def?.local_id === 'string' ? def.local_id : row.step.stepOid;
      try {
        const verified = await verifySignature(db, auth, { esig: esig!, loginName, password, workCenterId: row.a.workCenterId, operatorUserId: userId });
        verifiedSignature = { verified, workCenterName: row.workCenterName, operatorLoginName: operator?.loginName ?? '' };
      } catch (err) {
        if (!(err instanceof SignatureError)) throw err;
        // Spec D6: every failed attempt is audited — outside any transaction (none is open yet).
        await insertStepSignature(db, {
          workflowInstanceId: row.instanceId, runtimeNumber: row.runtimeNumber, runtimeLabel: row.runtimeLabel, workCenterId: row.a.workCenterId, workCenterName: row.workCenterName,
          stepInstanceId: row.step.id, stepOid: row.step.stepOid, stepName,
          signerUserId: err.signerUserId, signerLoginName: loginName.toLowerCase(), signerDisplayName: err.signerDisplayName,
          roleId: err.roleId, roleName: esig!.roleName ?? null, operatorUserId: userId, operatorLoginName: operator?.loginName ?? '',
          meaning: esig!.meaning ?? null, decision: body.kind === 'decision' ? body.value : null,
          outcome: 'failed', failureCode: err.code,
        });
        return c.json({ code: err.code, error: err.message }, (SIGNATURE_HTTP_STATUS[err.code] ?? 403) as ContentfulStatusCode);
      }
    }

    // The client never names steps — step_oid comes from the assignment's own step row (spec §5.3).
    // Deviation from a naive translation: step-handlers.ts's YES_NO branch (handleUserAction)
    // routes ONLY off `button_output` (never off `action.action`) — `button_output` must carry
    // the decision literal too, or routing falls through to "every outgoing connection" (see
    // getRoutedConnections) instead of the one true branch.
    const action: UserAction = body.kind === 'decision'
      ? { step_oid: row.step.stepOid, action: body.value as 'yes' | 'no', button_output: body.value, form_values: body.values as Record<string, unknown> | undefined }
      : { step_oid: row.step.stepOid, action: 'submit', form_values: (body.kind === 'submit' ? body.values : {}) ?? {} };
    try {
      await submitUserAction(db, row.instanceId, action, 'auto', deps, { assignmentId: row.a.id, userId, signature: verifiedSignature });
    } catch (err) {
      if (err instanceof EngineError) return c.json({ code: err.code, error: err.message }, 409);
      throw err;
    }
    hub?.notifyWorkCenter(row.a.workCenterId);
    return c.json({ ok: true });
  });

  return app;
}
