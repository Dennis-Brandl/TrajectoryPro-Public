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
import { db } from '../lib/db';
import { workflowView } from 'mission-control-db/src/dao/hierarchies';
import { deleteWorkflow, setWorkflowDispatchPolicy, setWorkflowAutoClaim } from 'mission-control-db/src/dao/workflows';
import { workflowDiagram } from 'mission-control-db/src/dao/workflow-diagram';
import { requireSession, requirePermission, type Vars } from '../middleware/auth';
import { requireUuidParams } from '../middleware/validate';
import { httpError, sendError } from '../lib/errors';

// All /api/workflows/* routes require a session. The bare-list GET /api/workflows lives in
// pickerRoutes; the '/*' mount here does not shadow it.
//
// M6 reduced this surface to read + delete. The PATCH (re-file into a library), the two
// link/unlink verbs, and POST /workflows/import are all gone: libraries no longer exist,
// linking is implicit in loading, and loading moved to POST /api/work-centers/:id/load so
// one action can mix .WFmasterX and .WFenvirX across several work centers.
export const workflowRoutes = new Hono<{ Variables: Vars }>();
workflowRoutes.use('/workflows/*', requireSession);

workflowRoutes.get('/workflows/:id', requireUuidParams('id'), requirePermission('workflow:read'), async (c) => {
  const view = await workflowView(db, c.req.param('id'));
  if (!view) return httpError(c, 404, 'not_found', 'Workflow not found');
  return c.json(view);
});

// The Diagram tab's payload: a projected, drawable subset of spec_jsonb, recursively
// including embedded child specs. Separate from GET /workflows/:id because the view is
// deliberately light — see the specJsonb projection in dao/hierarchies.ts.
workflowRoutes.get('/workflows/:id/diagram', requireUuidParams('id'), requirePermission('workflow:read'), async (c) => {
  const diagram = await workflowDiagram(db, c.req.param('id'));
  if (!diagram) return httpError(c, 404, 'not_found', 'Workflow not found');
  return c.json(diagram);
});

// Phase 4a (spec 2026-08-03 §6): the dispatch policy's long-promised surfacing. Suggest-only —
// the engine records a preferred user on offers; any eligible operator can claim. Gated on
// 'workflow:edit' (dao/access.ts CATEGORY_VERBS generates it from the curated workflow verb
// set ['read','create','edit','delete']) rather than 'workflow:delete' — no
// 'workflow:update'/'workflow:write' literal exists, but 'workflow:edit' already does, and
// that IS the workflow-write permission the Step 1 brief's first branch asks for.
workflowRoutes.patch('/workflows/:id/dispatch-policy', requireUuidParams('id'), requirePermission('workflow:edit'), async (c) => {
  const body = await c.req.json().catch(() => null) as { policy?: unknown } | null;
  // typeof guard before `in`: `true`/`1`/`"x"` are valid JSON bodies, and `'policy' in true`
  // throws (→ 500) instead of 400ing like every other malformed body (review fix).
  if (!body || typeof body !== 'object' || !('policy' in body)) return httpError(c, 400, 'bad_request', 'policy is required (string or null)');
  if (body.policy !== null && typeof body.policy !== 'string') return httpError(c, 400, 'bad_request', 'policy must be a string or null');
  try {
    await setWorkflowDispatchPolicy(db, c.req.param('id'), body.policy);
    return c.body(null, 204);
  } catch (err) {
    return sendError(c, err, 'Update failed');
  }
});

// Auto-claim override (spec 2026-08-14 D4): same shape and gating as dispatch-policy above.
// `value: null` = inherit the owning work center's autoClaim.
workflowRoutes.patch('/workflows/:id/auto-claim', requireUuidParams('id'), requirePermission('workflow:edit'), async (c) => {
  const body = await c.req.json().catch(() => null) as { value?: unknown } | null;
  // typeof guard before `in` — same primitive-body 500 hazard as dispatch-policy above.
  if (!body || typeof body !== 'object' || !('value' in body)) return httpError(c, 400, 'bad_request', 'value is required (boolean or null)');
  if (body.value !== null && typeof body.value !== 'boolean') return httpError(c, 400, 'bad_request', 'value must be a boolean or null');
  try {
    await setWorkflowAutoClaim(db, c.req.param('id'), body.value);
    return c.body(null, 204);
  } catch (err) {
    return sendError(c, err, 'Update failed');
  }
});

workflowRoutes.delete('/workflows/:id', requireUuidParams('id'), requirePermission('workflow:delete'), async (c) => {
  try {
    await deleteWorkflow(db, c.req.param('id'));
    return c.body(null, 204);
  } catch (err) {
    return sendError(c, err, 'Delete failed');
  }
});
