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
import { buildWfcenterx, previewWfcenterx } from 'mission-control-db/src/package/export';
import { importWfcenterx } from 'mission-control-db/src/package/import';
import type { PackageScope } from 'mission-control-db/src/package/wfcenter-format';
import { DaoError } from 'mission-control-db/src/dao/errors';
import { eq } from 'drizzle-orm';
import { requireSession, requirePermission, type Vars } from '../middleware/auth';
import { requireUuidParams, isUuid } from '../middleware/validate';
import { importBodyLimit } from '../middleware/upload-limit';
import { httpError } from '../lib/errors';
import { hasRight } from 'mission-control-db/src/dao/access';
import { workCenter } from 'mission-control-db/src/db/schema/index';

export const packageRoutes = new Hono<{ Variables: Vars }>();

// requirePermission (../middleware/auth.ts) has its own `if (!principal) return 401` guard,
// so an anonymous request 401s either way — that alone does not prove this mount matters.
// What requireSession actually does that nothing else here can substitute for is POPULATE
// c.set('principal', ...); requirePermission only reads it. Without this mount, every
// authenticated request below would see an empty principal and 401 too, even for a real
// viewer. (In the assembled app, work-centers.ts's own '/work-centers/*' mount — registered
// earlier in app.ts — happens to cover these same paths and would keep them working; this
// mount is kept anyway so packageRoutes remains correct in isolation, same convention as
// every other router.)
packageRoutes.use('/work-centers/*', requireSession);
packageRoutes.use('/work-centers/:id/package', requireUuidParams('id'));
packageRoutes.use('/work-centers/:id/package/preview', requireUuidParams('id'));

const SCOPES: PackageScope[] = ['all', 'effective'];

function parseScope(raw: string | undefined): PackageScope {
  const scope = (raw ?? 'all') as PackageScope;
  if (!SCOPES.includes(scope)) throw new DaoError('INVALID_SCOPE', `Unknown scope: ${raw}`);
  return scope;
}

/**
 * RFC 5987. Work-center names are unrestricted text, so a raw name in the header can emit a
 * malformed value (a quote closes the field early) or an unencodable one (non-ASCII). Both
 * the plain `filename=` fallback and the encoded `filename*=` are sent: the fallback is
 * ASCII-sanitised for old clients, and every modern browser prefers `filename*`.
 */
function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

packageRoutes.get(
  '/work-centers/:id/package',
  requirePermission('work_center:read'),
  async (c) => {
    const scope = parseScope(c.req.query('scope'));
    const { buffer, filename } = await buildWfcenterx(db, c.req.param('id'), {
      scope, exportedAt: new Date(),
    });
    return c.body(new Uint8Array(buffer), 200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': contentDisposition(filename),
      'Content-Length': String(buffer.byteLength),
    });
  },
);

packageRoutes.get(
  '/work-centers/:id/package/preview',
  requirePermission('work_center:read'),
  async (c) => {
    const scope = parseScope(c.req.query('scope'));
    return c.json(await previewWfcenterx(db, c.req.param('id'), scope));
  },
);

// All three create rights are required. That is not over-strict: principal rights are
// derived purely from the access tier (dao/access.ts TIER_RIGHTS), and every tier that holds
// one of these holds the other two — so this can never deny a steward who could legitimately
// import a package that happens to create work centers, workflows AND environments in one go
// (which every import does). Checking per artifact kind would add a branch that no tier can
// currently exercise. Same pattern as routes/load.ts:25-30.
packageRoutes.post(
  '/work-centers/import',
  requirePermission('work_center:create'),
  requirePermission('workflow:create'),
  requirePermission('environment:create'),
  importBodyLimit,
  async (c) => {
    const body = await c.req.parseBody({ all: true });
    const file = ([] as unknown[]).concat(body['file'] ?? []).find((f): f is File => f instanceof File);
    if (!file) return httpError(c, 400, 'validation', 'a package file is required');

    const field = (name: string): string | undefined => {
      const raw = ([] as unknown[]).concat(body[name] ?? []).find((v) => typeof v === 'string');
      return typeof raw === 'string' ? raw.trim() : undefined;
    };

    // §8.9: defaults to create so the existing renderer and e2e suite, which post no `mode`
    // field at all, keep working untouched.
    const mode = field('mode') || 'create';
    if (mode !== 'create' && mode !== 'merge') {
      return httpError(c, 400, 'validation', 'mode must be "create" or "merge"');
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const downloadedBy = c.get('principal').userId;

    if (mode === 'create') {
      // Blank (including whitespace-only) means "no parent" — a new root. Anything else must
      // be a real uuid: a malformed value would otherwise reach createWorkCenter's
      // `eq(workCenter.id, parentId)` against a Postgres uuid column, which throws a raw
      // driver error ("invalid input syntax for type uuid") that app.onError can only map to a
      // generic 500 — not the clean 400 a bad request deserves.
      const parentTrimmed = field('parentWorkCenterId') ?? '';
      let parentWorkCenterId: string | null = null;
      if (parentTrimmed.length) {
        if (!isUuid(parentTrimmed)) return httpError(c, 400, 'validation', 'parentWorkCenterId must be a uuid');
        parentWorkCenterId = parentTrimmed;
      }
      return c.json(await importWfcenterx(db, buf, { mode: 'create', parentWorkCenterId, downloadedBy }));
    }

    // Merge. §8.9: the edit right is checked HERE, on this branch only. As route middleware it
    // would gate create on edit too — a rule nobody intends, undetectable today only because
    // rightsFor() gives every tier both rights or neither.
    const principal = c.get('principal');
    if (principal.accessLevel !== 'administrator' && !hasRight(principal, 'work_center:edit')) {
      return httpError(c, 403, 'forbidden', 'Missing permission: work_center:edit');
    }

    const targetWorkCenterId = field('targetWorkCenterId') ?? '';
    if (!isUuid(targetWorkCenterId)) {
      return httpError(c, 400, 'validation', 'targetWorkCenterId must be a uuid');
    }
    const [target] = await db.select({ id: workCenter.id }).from(workCenter)
      .where(eq(workCenter.id, targetWorkCenterId)).limit(1);
    if (!target) return httpError(c, 404, 'not_found', 'Work center not found');

    // Strict equality, not truthiness — the string "false" must NOT apply the merge. Same rule
    // and same reason as DELETE /work-centers/:id (routes/work-centers.ts:105).
    const confirmed = field('confirmed') === 'true';
    const report = await importWfcenterx(db, buf, {
      mode: 'merge', targetWorkCenterId, confirmed, downloadedBy,
    });
    if (!confirmed) {
      // Mirrors the delete preflight's envelope so the dialog reads one shape for both.
      return c.json({ error: { code: 'conflict', message: 'Confirmation required', impact: report } }, 409);
    }
    return c.json(report);
  },
);
