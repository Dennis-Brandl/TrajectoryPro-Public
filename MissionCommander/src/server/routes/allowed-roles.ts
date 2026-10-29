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
import { listAllowedRoles, setAllowedRoles } from 'mission-control-db/src/dao/allowed-roles';
import { requireSession, requirePermission, type Vars } from '../middleware/auth';
import { requireUuidParams } from '../middleware/validate';
import { httpError, sendError } from '../lib/errors';

// M6 dropped the /work-centers/:id prefix these routes used to carry: allowed roles now
// hang off the workflow ENTRY, and an entry belongs to exactly one work center, so the
// segment named something the workflow id already determined. Two work centers holding the
// same oid are separate entries with separate assignments — the DAO enforces that, and
// these routes must not reintroduce a work-center-scoped lookup on top of it.
export const allowedRolesRoutes = new Hono<{ Variables: Vars }>();

allowedRolesRoutes.use('/workflows/:workflowId/allowed-roles', requireSession);

allowedRolesRoutes.get(
  '/workflows/:workflowId/allowed-roles',
  requireUuidParams('workflowId'),
  requirePermission('work_center:read'),
  async (c) => {
    const view = await listAllowedRoles(db, c.req.param('workflowId'));
    if (!view) return httpError(c, 404, 'not_found', 'Workflow not found');
    return c.json(view);
  },
);

// work_center:link stays the mutating right (spec §6.4). The per-role POST/DELETE verbs
// that used to live here were retired when the editor became a draft dialog committing
// through one PUT — they had exactly one caller and it no longer exists. The DAO's
// addAllowedRole/removeAllowedRole remain: seed/demo.ts still uses them.

// The complete desired grant set for the whole workflow, not a diff — the dialog is a
// draft editor whose Save is all-or-nothing. Same mutating right as the per-role verbs.
// Bound the payload the way this repo bounds every other untrusted input (MAX_IMPORT_BYTES,
// MAX_NAME_LENGTH, MAX_SPEC_DEPTH). The binding constraint is NOT inArray: setAllowedRoles
// builds one row of three columns per (node, role) pair, so the insert spends 3 bind
// parameters per pair against Postgres's 65535 ceiling — roughly 21,845 pairs. Two
// independent .max() calls cannot express that, because the ceiling is on their PRODUCT;
// hence the explicit total below, which keeps the guarantee true if either number is later
// raised in isolation.
const MAX_ALLOWED_ROLE_NODES = 500;
const MAX_ROLE_IDS_PER_NODE = 100;
const MAX_ALLOWED_ROLE_PAIRS = 10_000;   // x3 binds = 30k, comfortably under the ceiling

const setBody = z.object({
  nodes: z.array(z.object({
    nodeId: z.string().uuid(),
    roleIds: z.array(z.string().uuid()).max(MAX_ROLE_IDS_PER_NODE),
  })).max(MAX_ALLOWED_ROLE_NODES),
}).superRefine((v, ctx) => {
  const pairs = v.nodes.reduce((n, node) => n + node.roleIds.length, 0);
  if (pairs > MAX_ALLOWED_ROLE_PAIRS) {
    ctx.addIssue({
      code: 'too_big', maximum: MAX_ALLOWED_ROLE_PAIRS, origin: 'array',
      inclusive: true, path: ['nodes'], message: 'Too many node/role pairs',
    });
  }
});

allowedRolesRoutes.put(
  '/workflows/:workflowId/allowed-roles',
  requireUuidParams('workflowId'),
  requirePermission('work_center:link'),
  async (c) => {
    const parsed = setBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return httpError(c, 400, 'validation', 'Invalid allowed-roles payload');
    try {
      const view = await setAllowedRoles(db, c.req.param('workflowId'), parsed.data.nodes);
      if (!view) return httpError(c, 404, 'not_found', 'Workflow not found');
      return c.json(view);
    } catch (err) {
      return sendError(c, err, 'Save failed');
    }
  },
);
