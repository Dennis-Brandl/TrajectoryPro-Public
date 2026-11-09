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
import { Hono, type Context } from 'hono';
import { db } from '../lib/db';
import {
  API_CLIENT_SCOPES, createApiClient, listApiClients, revokeApiClient, type ApiClientScope,
} from 'mission-control-db/src/dao/api-clients';
import { requireSession, requireAdministrator, type Vars } from '../middleware/auth';
import { requireUuidParams, isUuid } from '../middleware/validate';
import { httpError, sendDaoError } from '../lib/errors';
import { safeErrorText } from '../middleware/api-client';
import { readJsonObject } from '../lib/json-body';

// Like sendError, but never logs the error object: a database error's message can carry the
// query parameters, which here include a token hash.
function sendError(c: Context, err: unknown, fallbackMessage: string): Response {
  const daoResponse = sendDaoError(c, err);
  if (daoResponse) return daoResponse;
  console.error(`[route] ${c.req.method} ${c.req.path}:`, safeErrorText(err));
  return httpError(c, 500, 'internal', fallbackMessage);
}

// API clients (spec 2026-11-08 §8.1): Administrator only. The audit is in the api_client row
// itself (created_by, revoked_at); these writes append nothing to the schedule event log.
export const apiClientRoutes = new Hono<{ Variables: Vars }>();
apiClientRoutes.use('/api-clients', requireSession, requireAdministrator);
apiClientRoutes.use('/api-clients/*', requireSession, requireAdministrator);

const MAX_NAME = 200;
const MAX_WORK_CENTERS = 500;
const ALLOWED_FIELDS = new Set(['name', 'scopes', 'workCenterIds', 'expiresAt']);

apiClientRoutes.get('/api-clients', async (c) => {
  try {
    return c.json(await listApiClients(db));
  } catch (err) {
    return sendError(c, err, 'Failed to list API clients');
  }
});

apiClientRoutes.post('/api-clients', async (c) => {
  const body = await readJsonObject(c);
  if (!body) return httpError(c, 400, 'bad_request', 'Body must be a JSON object');
  const unknown = Object.keys(body).find((k) => !ALLOWED_FIELDS.has(k));
  if (unknown) return httpError(c, 422, 'validation', `Unknown field: ${unknown}`);

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > MAX_NAME) return httpError(c, 422, 'validation', `name must be 1 to ${MAX_NAME} characters`);

  const { scopes, workCenterIds } = body;
  if (!Array.isArray(scopes) || scopes.length === 0
    || !scopes.every((s) => typeof s === 'string' && (API_CLIENT_SCOPES as readonly string[]).includes(s))) {
    return httpError(c, 422, 'validation', `scopes must be one or more of: ${API_CLIENT_SCOPES.join(', ')}`);
  }
  if (!Array.isArray(workCenterIds) || workCenterIds.length === 0 || workCenterIds.length > MAX_WORK_CENTERS
    || !workCenterIds.every((id) => typeof id === 'string' && isUuid(id))) {
    return httpError(c, 422, 'validation', 'workCenterIds must be one or more work center ids');
  }

  let expiresAt: Date | undefined;
  if (body.expiresAt !== undefined && body.expiresAt !== null) {
    expiresAt = typeof body.expiresAt === 'string' ? new Date(body.expiresAt) : new Date(NaN);
    if (Number.isNaN(expiresAt.getTime())) return httpError(c, 422, 'validation', 'expiresAt must be a date and time');
    if (expiresAt.getTime() <= Date.now()) return httpError(c, 422, 'validation', 'expiresAt must be in the future');
  }

  try {
    const result = await createApiClient(
      db, { name, scopes: scopes as ApiClientScope[], workCenterIds: workCenterIds as string[], expiresAt },
      c.get('principal').userId,
    );
    // The token is in this response and nowhere else, so nothing may cache it.
    c.header('Cache-Control', 'no-store');
    return c.json(result, 201);
  } catch (err) {
    return sendError(c, err, 'Failed to create API client');
  }
});

apiClientRoutes.post('/api-clients/:id/revoke', requireUuidParams('id'), async (c) => {
  try {
    await revokeApiClient(db, c.req.param('id'), new Date());
    return c.body(null, 204);
  } catch (err) {
    return sendError(c, err, 'Failed to revoke API client');
  }
});
