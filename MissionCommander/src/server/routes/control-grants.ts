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
import { httpError, sendError } from '../lib/errors';
import { requireSession, requirePermission, requireAdministrator, type Vars } from '../middleware/auth';
import { requireUuidParams } from '../middleware/validate';
import { listControlGrants, setControlGrant, deleteControlGrant } from 'mission-control-db/src/dao/control-grants';

const putBody = z.object({ scope: z.enum(['own', 'any']) }).strict();

export const controlGrantRoutes = new Hono<{ Variables: Vars }>();
controlGrantRoutes.use('/work-centers/:id/control-grants', requireSession);
controlGrantRoutes.use('/work-centers/:id/control-grants/*', requireSession);

// Spec 2026-10-15 §2.2 (R7). Read like environment bindings (every tier holds work_center:read);
// writes are administrator-only.
controlGrantRoutes.get('/work-centers/:id/control-grants', requireUuidParams('id'), requirePermission('work_center:read'), async (c) => {
  try { return c.json(await listControlGrants(db, c.req.param('id'))); }
  catch (err) { return sendError(c, err, 'Listing control grants failed'); }
});

controlGrantRoutes.put('/work-centers/:id/control-grants/:targetId', requireUuidParams('id', 'targetId'), requireAdministrator, async (c) => {
  const parsed = putBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return httpError(c, 400, 'validation', 'scope must be "own" or "any"');
  try {
    await setControlGrant(db, {
      sourceWorkCenterId: c.req.param('id'), targetWorkCenterId: c.req.param('targetId'),
      scope: parsed.data.scope, userId: c.get('principal').userId,
    });
    return c.body(null, 204);
  } catch (err) { return sendError(c, err, 'Saving control grant failed'); }
});

controlGrantRoutes.delete('/work-centers/:id/control-grants/:targetId', requireUuidParams('id', 'targetId'), requireAdministrator, async (c) => {
  try { await deleteControlGrant(db, c.req.param('id'), c.req.param('targetId')); return c.body(null, 204); }
  catch (err) { return sendError(c, err, 'Removing control grant failed'); }
});
