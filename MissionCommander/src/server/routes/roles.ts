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
import { createRole, listRoles, updateRole, deleteRole } from 'mission-control-db/src/dao/roles';
import { roleView } from 'mission-control-db/src/dao/hierarchies';
import { requireSession, requirePermission, type Vars } from '../middleware/auth';
import { requireUuidParams } from '../middleware/validate';
import { errorBody, httpError, sendError } from '../lib/errors';
import { readJsonObject } from '../lib/json-body';

export const rolesRoutes = new Hono<{ Variables: Vars }>();

rolesRoutes.use('/roles', requireSession);
rolesRoutes.use('/roles/*', requireSession);

rolesRoutes.get('/roles', requirePermission('role:read'), async (c) => {
  return c.json({ roles: await listRoles(db) });
});

rolesRoutes.get(
  '/roles/:id',
  requireUuidParams('id'),
  requirePermission('role:read'),
  async (c) => {
    const view = await roleView(db, c.req.param('id'));
    if (!view) return httpError(c, 404, 'not_found', 'Role not found');
    return c.json(view);
  },
);

rolesRoutes.post('/roles', requirePermission('role:create'), async (c) => {
  const inputRaw = await readJsonObject(c);
  if (!inputRaw) return c.json(errorBody('bad_request', 'Request body must be a JSON object'), 400);
  const input = inputRaw as { name?: string; description?: string | null };
  if (!input.name || typeof input.name !== 'string') {
    return httpError(c, 400, 'validation', 'name is required');
  }
  try {
    const r = await createRole(db, { name: input.name, description: input.description ?? null });
    const view = await roleView(db, r.id);
    return c.json(view, 201);
  } catch (err) {
    return sendError(c, err, 'Create failed');
  }
});

rolesRoutes.patch(
  '/roles/:id',
  requireUuidParams('id'),
  requirePermission('role:edit'),
  async (c) => {
    const inputRaw = await readJsonObject(c);
    if (!inputRaw) return c.json(errorBody('bad_request', 'Request body must be a JSON object'), 400);
    const input = inputRaw as { name?: string; description?: string | null };
    if (input.name !== undefined && (typeof input.name !== 'string' || input.name === '')) {
      return httpError(c, 400, 'validation', 'name must be a non-empty string');
    }
    try {
      await updateRole(db, c.req.param('id'), { name: input.name, description: input.description });
      const view = await roleView(db, c.req.param('id'));
      return c.json(view);
    } catch (err) {
      return sendError(c, err, 'Update failed');
    }
  },
);

rolesRoutes.delete(
  '/roles/:id',
  requireUuidParams('id'),
  requirePermission('role:delete'),
  async (c) => {
    try {
      await deleteRole(db, c.req.param('id'));
      return c.body(null, 204);
    } catch (err) {
      return sendError(c, err, 'Delete failed');
    }
  },
);
