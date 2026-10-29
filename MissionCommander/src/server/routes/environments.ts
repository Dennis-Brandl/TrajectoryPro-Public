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
import { envSpecView } from 'mission-control-db/src/dao/hierarchies';
import { deleteEnvironmentSpec } from 'mission-control-db/src/dao/environments';
import { listEnvironmentResources, listEnvironmentValueProperties } from 'mission-control-db/src/dao/shared-state';
import { requireSession, requirePermission, type Vars } from '../middleware/auth';
import { requireUuidParams } from '../middleware/validate';
import { httpError, sendError } from '../lib/errors';

// All /api/environments/* routes require a session. The bare-list GET /api/environments
// lives in pickerRoutes; the '/*' mount here does not shadow it.
//
// M6 reduced this surface to read + delete, mirroring workflows.ts: no library to re-file
// into, no explicit link verbs, and loading moved to POST /api/work-centers/:id/load.
export const environmentRoutes = new Hono<{ Variables: Vars }>();
environmentRoutes.use('/environments/*', requireSession);

environmentRoutes.get('/environments/:id', requireUuidParams('id'), requirePermission('environment:read'), async (c) => {
  const view = await envSpecView(db, c.req.param('id'));
  if (!view) return httpError(c, 404, 'not_found', 'Environment not found');
  return c.json(view);
});

// Phase 3 (spec §6.2): the shared-state read surface for ONE environment spec — the
// work-center registry rows filtered to what this spec declares. Read-only, gated like the
// detail view, polled at 2 s by the pane (so the DAO keeps its projection narrow).
environmentRoutes.get('/environments/:id/resources', requireUuidParams('id'), requirePermission('environment:read'), async (c) => {
  const view = await listEnvironmentResources(db, c.req.param('id'));
  if (!view) return httpError(c, 404, 'not_found', 'Environment not found');
  return c.json(view);
});

environmentRoutes.get('/environments/:id/value-properties', requireUuidParams('id'), requirePermission('environment:read'), async (c) => {
  const view = await listEnvironmentValueProperties(db, c.req.param('id'));
  if (!view) return httpError(c, 404, 'not_found', 'Environment not found');
  return c.json(view);
});

environmentRoutes.delete('/environments/:id', requireUuidParams('id'), requirePermission('environment:delete'), async (c) => {
  try {
    await deleteEnvironmentSpec(db, c.req.param('id'));
    return c.body(null, 204);
  } catch (err) {
    return sendError(c, err, 'Delete failed');
  }
});
