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
import { z } from 'zod';
import { db } from '../lib/db';
import {
  createRuntimeWorkflow, listRuntimeWorkflowsPage, RUNTIME_LIST_MAX_PAGE_SIZE, getRuntimeWorkflowLive,
  requestStart, deleteRuntimeWorkflow, listActiveRuntimeLeaves, listAssignmentCandidates,
  getRuntimeWorkflowLiveStates,
  getStartingParameterSpecs, workCenterIdForWorkflow, workCenterIdForInstance, workCenterIdForAssignment,
} from 'mission-control-db/src/dao/runtime-workflows';
import { getRuntimeWorkflowDiagram } from 'mission-control-db/src/dao/workflow-diagram';
import { listCreatedRuntimes } from 'mission-control-db/src/dao/runtime-children';
import { listInstanceResources, listInstanceValueProperties } from 'mission-control-db/src/dao/shared-state';
import { listRootWorkCenters, subtree } from 'mission-control-db/src/dao/work-centers';
import { listWorkCenterPresence } from 'mission-control-db/src/dao/presence';
import { MAX_STARTING_PARAMS, MAX_STARTING_PARAM_VALUE_LENGTH } from 'mission-control-db/src/runtime/instantiate';
import { requireSession, requirePermission, requireMissionSystemCommander, type Vars } from '../middleware/auth';
import { requireUuidParams } from '../middleware/validate';
import { httpError, sendError } from '../lib/errors';
import { engineControl, engineForceRelease, engineAssign, engineInstanceResourceVerb, engineSetInstanceValue, engineForceComplete } from '../lib/engine-client';
import { proxyEngine } from '../lib/engine-proxy';
import { RESOURCE_VERBS, instanceResourceVerbBody, instanceValueBody } from '../lib/shared-state-bodies';

// Instance-scoped routes carry no /work-centers prefix — the instance id alone determines
// its work center (allowed-roles precedent); requireMissionSystemCommander re-derives it per hit.
export const runtimeWorkflowRoutes = new Hono<{ Variables: Vars }>();

runtimeWorkflowRoutes.use('/workflows/:workflowId/runtime-parameters', requireSession);
runtimeWorkflowRoutes.use('/workflows/:workflowId/runtime-workflows', requireSession);
runtimeWorkflowRoutes.use('/work-centers/:id/runtime-workflows', requireSession);
runtimeWorkflowRoutes.use('/work-centers/:id/presence', requireSession);
runtimeWorkflowRoutes.use('/runtime-workflows/*', requireSession);

const createBody = z.object({
  params: z.record(z.string(), z.string().max(MAX_STARTING_PARAM_VALUE_LENGTH)).default({}),
  start: z.boolean().default(false),
}).strict().superRefine((v, ctx) => {
  if (Object.keys(v.params).length > MAX_STARTING_PARAMS) {
    ctx.addIssue({ code: 'custom', path: ['params'], message: 'Too many parameters' });
  }
});

// Gates on work_center:read rather than workflow:read (unlike the diagram route in
// workflows.ts) to match its two siblings that also read-gate on work_center:read: the
// allowed-roles GET (allowed-roles.ts) and this file's own list route below. Not a security
// difference either way — every access tier holds both rights (TIER_RIGHTS in
// mission-control-db's dao/access.ts grants every :read verb to viewer).
runtimeWorkflowRoutes.get(
  '/workflows/:workflowId/runtime-parameters',
  requireUuidParams('workflowId'),
  requirePermission('work_center:read'),
  async (c) => {
    const view = await getStartingParameterSpecs(db, c.req.param('workflowId'));
    if (!view) return httpError(c, 404, 'not_found', 'Workflow not found');
    return c.json({
      workflowId: view.workflowId,
      parameters: view.parameters.map((p) => ({
        id: p.id, description: p.description, defaultValue: p.default_value, valueType: p.value_type,
      })),
    });
  },
);

runtimeWorkflowRoutes.post(
  '/workflows/:workflowId/runtime-workflows',
  requireUuidParams('workflowId'),
  // Non-null: the route pattern makes ':workflowId' mandatory, but the resolver's Context
  // type (declared in requireMissionSystemCommander, not this specific route) can't carry that
  // literal param key, so c.req.param() falls back to its untyped `string | undefined` overload.
  requireMissionSystemCommander((c) => workCenterIdForWorkflow(db, c.req.param('workflowId')!)),
  async (c) => {
    const parsed = createBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return httpError(c, 400, 'validation', 'Invalid runtime-workflow payload');
    try {
      const summary = await createRuntimeWorkflow(db, {
        workflowId: c.req.param('workflowId'),
        params: parsed.data.params,
        userId: c.get('principal').userId,
        start: parsed.data.start,
      });
      return c.json(summary, 201);
    } catch (err) {
      return sendError(c, err, 'Create failed');
    }
  },
);

const listQuery = z.object({
  filter: z.enum(['all', 'active', 'pending', 'finished']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(RUNTIME_LIST_MAX_PAGE_SIZE).default(24),
}).strict();

// Monitoring is deliberately open (spec §6.2): every tier holds work_center:read.
runtimeWorkflowRoutes.get(
  '/work-centers/:id/runtime-workflows',
  requireUuidParams('id'),
  requirePermission('work_center:read'),
  async (c) => {
    const parsed = listQuery.safeParse(c.req.query());
    if (!parsed.success) return httpError(c, 400, 'validation', 'Invalid list query');
    const { items, total, page, pageSize, statusCounts } = await listRuntimeWorkflowsPage(db, c.req.param('id'), parsed.data);
    return c.json({ runtimeWorkflows: items, total, page, pageSize, statusCounts });
  },
);

// CM Runtime pane (spec 2026-08-27 §4.2): the whole WC forest + every active instance in
// one response — the tree's single 5 s poll. Same open read gate as the monitoring list.
// No clash with the :id routes: nothing registers a bare GET /runtime-workflows/:id.
runtimeWorkflowRoutes.get(
  '/runtime-workflows/active',
  requirePermission('work_center:read'),
  async (c) => {
    const roots = await listRootWorkCenters(db);
    const nodeArrays = await Promise.all(roots.map((r) => subtree(db, r.id)));
    return c.json({ nodes: nodeArrays.flat(), runtimeWorkflows: await listActiveRuntimeLeaves(db) });
  },
);

// The instance's frozen recipe projected to geometry (spec §4.4) — fetched once per
// instance by the client and cached; reads via shared DAO, engine untouched (D8 seam).
runtimeWorkflowRoutes.get(
  '/runtime-workflows/:id/diagram',
  requireUuidParams('id'),
  requirePermission('work_center:read'),
  async (c) => {
    const diagram = await getRuntimeWorkflowDiagram(db, c.req.param('id'));
    if (!diagram) return httpError(c, 404, 'not_found', 'Runtime workflow not found');
    return c.json(diagram);
  },
);

// The 2 s live-coloring payload (spec §4.4). mine flags are computed for the caller (the
// commander) and ignored by the Runtime pane — passing the principal keeps the shared DAO
// signature honest rather than inventing a null-user variant.
runtimeWorkflowRoutes.get(
  '/runtime-workflows/:id/live-states',
  requireUuidParams('id'),
  requirePermission('work_center:read'),
  async (c) => {
    const live = await getRuntimeWorkflowLiveStates(db, c.req.param('id'), c.get('principal').userId);
    if (!live) return httpError(c, 404, 'not_found', 'Runtime workflow not found');
    return c.json(live);
  },
);

runtimeWorkflowRoutes.get(
  '/runtime-workflows/:id/live',
  requireUuidParams('id'),
  requirePermission('work_center:read'),
  async (c) => {
    const detail = await getRuntimeWorkflowLive(db, c.req.param('id'));
    if (!detail) return httpError(c, 404, 'not_found', 'Runtime workflow not found');
    return c.json(detail);
  },
);

// Spec 2026-10-19 §A: the runtimes this one created. Same open read gate as /live.
runtimeWorkflowRoutes.get('/runtime-workflows/:id/children', requireUuidParams('id'), requirePermission('work_center:read'),
  async (c) => c.json(await listCreatedRuntimes(db, c.req.param('id'))));

// Phase 3 (spec §6.5): this instance's workflow-scoped pools (projected from engine_state by
// the DAO, never shipped whole) plus the environment resources it holds or waits on. Same
// read gate as /live above.
runtimeWorkflowRoutes.get(
  '/runtime-workflows/:id/resources',
  requireUuidParams('id'),
  requirePermission('work_center:read'),
  async (c) => {
    const view = await listInstanceResources(db, c.req.param('id'));
    if (!view) return httpError(c, 404, 'not_found', 'Runtime workflow not found');
    return c.json(view);
  },
);

runtimeWorkflowRoutes.get(
  '/runtime-workflows/:id/value-properties',
  requireUuidParams('id'),
  requirePermission('work_center:read'),
  async (c) => {
    const view = await listInstanceValueProperties(db, c.req.param('id'));
    if (!view) return httpError(c, 404, 'not_found', 'Runtime workflow not found');
    return c.json(view);
  },
);

runtimeWorkflowRoutes.get(
  '/work-centers/:id/presence',
  requireUuidParams('id'),
  requirePermission('work_center:read'),
  async (c) => c.json({ presence: await listWorkCenterPresence(db, c.req.param('id')) }),
);

runtimeWorkflowRoutes.post(
  '/runtime-workflows/:id/start',
  requireUuidParams('id'),
  // Non-null: same rationale as the create route above — ':id' is mandatory in the pattern.
  requireMissionSystemCommander((c) => workCenterIdForInstance(db, c.req.param('id')!)),
  async (c) => {
    try {
      return c.json(await requestStart(db, c.req.param('id'), c.get('principal').userId));
    } catch (err) {
      return sendError(c, err, 'Start failed');
    }
  },
);

runtimeWorkflowRoutes.delete(
  '/runtime-workflows/:id',
  requireUuidParams('id'),
  // Non-null: same rationale as the create route above — ':id' is mandatory in the pattern.
  requireMissionSystemCommander((c) => workCenterIdForInstance(db, c.req.param('id')!)),
  async (c) => {
    try {
      await deleteRuntimeWorkflow(db, c.req.param('id'));
      return c.body(null, 204);
    } catch (err) {
      return sendError(c, err, 'Delete failed');
    }
  },
);

// ── Phase 6 controls (spec §5): thin commander-gated proxies to the engine's internal API.
// The engine is the single writer for these transitions; CM only authenticates, authorizes,
// and maps the wire result onto its own error envelope.

runtimeWorkflowRoutes.use('/assignments/*', requireSession);

const CONTROL_VERBS = ['pause', 'resume', 'stop', 'abort'] as const;
for (const verb of CONTROL_VERBS) {
  runtimeWorkflowRoutes.post(
    `/runtime-workflows/:id/${verb}`,
    requireUuidParams('id'),
    // Non-null: ':id' is mandatory in the pattern (same rationale as the start route above).
    requireMissionSystemCommander((c) => workCenterIdForInstance(db, c.req.param('id')!)),
    (c) => proxyEngine(c, () => engineControl(verb, c.req.param('id')), `${verb} failed`),
  );
}

runtimeWorkflowRoutes.post(
  '/assignments/:id/force-release',
  requireUuidParams('id'),
  // Non-null: ':id' is mandatory in the pattern.
  requireMissionSystemCommander((c) => workCenterIdForAssignment(db, c.req.param('id')!)),
  (c) => proxyEngine(c, () => engineForceRelease(c.req.param('id')), 'Force release failed'),
);

// Advisory member picker for commander assign (spec §4.6) — own-DB read; gates nothing.
runtimeWorkflowRoutes.get(
  '/assignments/:id/candidates',
  requireUuidParams('id'),
  requirePermission('work_center:read'),
  async (c) => {
    const view = await listAssignmentCandidates(db, c.req.param('id'));
    if (!view) return httpError(c, 404, 'not_found', 'Assignment not found');
    return c.json(view);
  },
);

const assignBody = z.object({ userId: z.string().uuid() }).strict();

// Commander assign proxy (spec §4.6): the engine is the writer and re-validates
// eligibility; CM authenticates, authorizes, and maps the wire result.
runtimeWorkflowRoutes.post(
  '/assignments/:id/assign',
  requireUuidParams('id'),
  // Non-null: ':id' is mandatory in the pattern.
  requireMissionSystemCommander((c) => workCenterIdForAssignment(db, c.req.param('id')!)),
  async (c) => {
    const parsed = assignBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return httpError(c, 400, 'validation', 'Invalid assign payload');
    return proxyEngine(c, () => engineAssign(c.req.param('id'), parsed.data.userId), 'Assign failed');
  },
);

// ── Phase 4b (spec §7.2): this instance's own pools and value stores. The engine decides the
// tier by the registry, not the key's shape (D16) — but the panes never send an ENVIRONMENT
// name here: an environment row acts on the whole work-center resource whichever instance it
// is reached through (spec §12.5 item 23), so the panes post those to the work-center routes.
// A shared VALUE key is refused by the engine (SHARED_KEY 409, D17) for the same reason.

for (const verb of RESOURCE_VERBS) {
  runtimeWorkflowRoutes.post(
    `/runtime-workflows/:id/resources/${verb}`,
    requireUuidParams('id'),
    // Non-null: ':id' is mandatory in the pattern.
    requireMissionSystemCommander((c) => workCenterIdForInstance(db, c.req.param('id')!)),
    async (c) => {
      const parsed = instanceResourceVerbBody.safeParse(await c.req.json().catch(() => ({})));
      if (!parsed.success) return httpError(c, 400, 'validation', 'Invalid resource verb payload');
      const id = c.req.param('id');
      const actorUserId = c.get('principal').userId;
      return proxyEngine(c, () => engineInstanceResourceVerb(id, verb, { ...parsed.data, actorUserId }), `${verb} failed`);
    },
  );
}

runtimeWorkflowRoutes.post(
  '/runtime-workflows/:id/value-properties',
  requireUuidParams('id'),
  // Non-null: ':id' is mandatory in the pattern.
  requireMissionSystemCommander((c) => workCenterIdForInstance(db, c.req.param('id')!)),
  async (c) => {
    const parsed = instanceValueBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return httpError(c, 400, 'validation', 'Invalid value payload');
    const id = c.req.param('id');
    const actorUserId = c.get('principal').userId;
    return proxyEngine(c, () => engineSetInstanceValue(id, { ...parsed.data, actorUserId }), 'Value update failed');
  },
);

// Spec 2026-10-13 §5.2: a commander forces a waiting gate — any gate, reason required.
const forceCompleteBody = z.object({ reason: z.string().trim().min(1).max(500) }).strict();

runtimeWorkflowRoutes.post(
  '/runtime-workflows/:id/steps/:stepInstanceId/force-complete',
  requireUuidParams('id', 'stepInstanceId'),
  // Non-null: ':id' is mandatory in the pattern.
  requireMissionSystemCommander((c) => workCenterIdForInstance(db, c.req.param('id')!)),
  async (c) => {
    const parsed = forceCompleteBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return httpError(c, 400, 'validation', 'A reason (1–500 characters) is required');
    const id = c.req.param('id');
    const stepInstanceId = c.req.param('stepInstanceId');
    const actorUserId = c.get('principal').userId;
    return proxyEngine(
      c, () => engineForceComplete(id, stepInstanceId, { actorUserId, reason: parsed.data.reason }),
      'Force complete failed',
    );
  },
);
