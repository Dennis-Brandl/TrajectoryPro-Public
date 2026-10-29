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
import { listEnvironmentBindings, setEnvironmentBinding } from 'mission-control-db/src/dao/environment-bindings';

const putBody = z.object({ serverUri: z.string().max(500) }).strict();

export const environmentBindingRoutes = new Hono<{ Variables: Vars }>();
environmentBindingRoutes.use('/work-centers/:id/environment-bindings', requireSession);
environmentBindingRoutes.use('/work-centers/:id/environment-bindings/*', requireSession);

// Monitoring-adjacent read (mirrors the runtime-workflows list route): every access tier
// holds work_center:read (dao/access.ts TIER_RIGHTS), so this never hides bindings from a
// viewer. Only the write below is administrator-gated.
environmentBindingRoutes.get(
  '/work-centers/:id/environment-bindings',
  requireUuidParams('id'), requirePermission('work_center:read'),
  async (c) => {
    try {
      return c.json(await listEnvironmentBindings(db, c.req.param('id')));
    } catch (err) {
      return sendError(c, err, 'Listing environment bindings failed');
    }
  },
);

// `:oid` is a text OID (environment_spec.oid), not a UUID — deliberately not run through
// requireUuidParams. An empty serverUri deletes the binding row (setEnvironmentBinding's
// unbind path); anything else must be an http(s) URL.
environmentBindingRoutes.put(
  '/work-centers/:id/environment-bindings/:oid',
  requireUuidParams('id'),
  requireAdministrator,
  async (c) => {
    const parsed = putBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return httpError(c, 400, 'validation', 'serverUri (string) is required');
    const { serverUri } = parsed.data;
    if (serverUri !== '' && !/^https?:\/\//.test(serverUri)) {
      return httpError(c, 400, 'validation', 'serverUri must be empty or an http(s) URL');
    }
    try {
      await setEnvironmentBinding(db, {
        workCenterId: c.req.param('id'),
        environmentOid: c.req.param('oid'),
        serverUri,
        userId: c.get('principal').userId,
      });
      return c.body(null, 204);
    } catch (err) {
      return sendError(c, err, 'Saving environment binding failed');
    }
  },
);
