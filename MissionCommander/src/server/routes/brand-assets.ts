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
// Spec 2026-10-09 §8.3/§12: Pilot logos. Upload is administrator-only (like every branding
// write) and runs the §12 cleaner; serving is public (R5 — the engine serves the same bytes
// to the Pilot; Commander serves them to its own editor preview) and immutable.
import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { db } from '../lib/db';
import { readBrandAsset, storeBrandAsset, brandAssetHeaders } from 'mission-control-db/src/dao/brand-assets';
import { cleanLogo, MAX_LOGO_BYTES, TOO_LARGE } from '../lib/brand-logo';
import { requireSession, type Vars } from '../middleware/auth';
import { httpError } from '../lib/errors';

export const brandAssetRoutes = new Hono<{ Variables: Vars }>();

const requireBrandingAdmin: MiddlewareHandler<{ Variables: Vars }> = async (c, next) => {
  if (c.get('principal').accessLevel !== 'administrator') {
    return httpError(c, 403, 'forbidden', 'Pilot branding requires an administrator');
  }
  await next();
};

// Multipart framing adds a little to the file; cleanLogo enforces the exact 256 KB.
const logoBodyLimit = bodyLimit({
  maxSize: MAX_LOGO_BYTES + 16 * 1024,
  onError: (c) => httpError(c, 413, 'too_large', TOO_LARGE),
});

brandAssetRoutes.get('/brand/:id', async (c) => {
  const asset = await readBrandAsset(db, c.req.param('id'));
  if (!asset) return httpError(c, 404, 'not_found', 'Not found');
  return c.body(new Uint8Array(asset.data), 200, brandAssetHeaders(asset.mime));
});

brandAssetRoutes.post('/brand-assets', requireSession, requireBrandingAdmin, logoBodyLimit, async (c) => {
  const body = await c.req.parseBody();
  const file = body['file'];
  if (!(file instanceof File)) return httpError(c, 422, 'validation', 'file is required');
  const result = await cleanLogo(Buffer.from(await file.arrayBuffer()));
  if (!result.ok) return httpError(c, 422, 'validation', result.message);
  await storeBrandAsset(db, result.logo);
  const { id, mime, width, height } = result.logo;
  return c.json({ id, mime, width, height }, 201);
});
