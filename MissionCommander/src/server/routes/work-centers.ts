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
import {
  listRootWorkCenters,
  subtree,
  createWorkCenter,
  updateWorkCenter,
  deleteWorkCenter,
  workCenterDeleteImpact,
  assignUserToWorkCenter,
  removeUserFromWorkCenter,
} from 'mission-control-db/src/dao/work-centers';
import { setWorkCenterUserRoles } from 'mission-control-db/src/dao/work-center-user-roles';
import { workCenterView } from 'mission-control-db/src/dao/hierarchies';
import { listWorkCenterResources, listWorkCenterValueProperties, workCenterExists } from 'mission-control-db/src/dao/shared-state';
import { DaoError } from 'mission-control-db/src/dao/errors';
import { eq } from 'drizzle-orm';
import { workCenter } from 'mission-control-db/src/db/schema/index';
import { MAX_TYPE_NAME_LENGTH, TYPE_NAME_TOO_LONG_MESSAGE } from 'mission-control-db/src/dao/type-name';
import { validateRuntimeIdTemplate } from 'mission-control-db/src/lib/runtime-id';
import { requireSession, requirePermission, requireMissionSystemCommander, type Vars } from '../middleware/auth';
import { requireUuidParams, isUuid } from '../middleware/validate';
import { errorBody, httpError, sendError } from '../lib/errors';
import { parseTheme, resolveTheme, checkContrast, describeFailure, type PilotTheme } from 'mission-control-db/src/dao/pilot-theme';
import { readSiteTheme, bumpThemeRev } from 'mission-control-db/src/dao/pilot-theme-store';
import {
  readThemeChain, writeWorkCenterTheme, brokenWorkCenterThemes, missingBrandAssets,
} from 'mission-control-db/src/dao/pilot-theme-chain';
import { engineWorkCenterResourceVerb, engineSetWorkCenterValue } from '../lib/engine-client';
import { proxyEngine } from '../lib/engine-proxy';
import { RESOURCE_VERBS, workCenterResourceVerbBody, workCenterValueBody } from '../lib/shared-state-bodies';
import { readJsonObject } from '../lib/json-body';

export const workCenterRoutes = new Hono<{ Variables: Vars }>();

workCenterRoutes.use('/work-centers', requireSession);
workCenterRoutes.use('/work-centers/*', requireSession);

// Flattened forest: every root's subtree, concatenated. subtree() includes the
// root itself at depth 0, so roots appear here with parentWorkCenterId === null.
workCenterRoutes.get('/work-centers', requirePermission('work_center:read'), async (c) => {
  const roots = await listRootWorkCenters(db);
  const nodeArrays = await Promise.all(roots.map((r) => subtree(db, r.id)));
  return c.json({ nodes: nodeArrays.flat() });
});

workCenterRoutes.get(
  '/work-centers/:id',
  requireUuidParams('id'),
  requirePermission('work_center:read'),
  async (c) => {
    const view = await workCenterView(db, c.req.param('id'));
    if (!view) return httpError(c, 404, 'not_found', 'Work center not found');
    return c.json(view);
  },
);

// Phase 3 (spec §6.4): the backstop view — every registry row of the work center, orphans
// included. Read-only; the operator verbs are Phase 4.
workCenterRoutes.get(
  '/work-centers/:id/resources',
  requireUuidParams('id'),
  requirePermission('work_center:read'),
  async (c) => {
    const resources = await listWorkCenterResources(db, c.req.param('id'));
    if (!resources) return httpError(c, 404, 'not_found', 'Work center not found');
    return c.json({ resources });
  },
);

workCenterRoutes.get(
  '/work-centers/:id/value-properties',
  requireUuidParams('id'),
  requirePermission('work_center:read'),
  async (c) => {
    const values = await listWorkCenterValueProperties(db, c.req.param('id'));
    if (!values) return httpError(c, 404, 'not_found', 'Work center not found');
    return c.json({ values });
  },
);

workCenterRoutes.post('/work-centers', requirePermission('work_center:create'), async (c) => {
  const inputRaw = await readJsonObject(c);
  if (!inputRaw) return c.json(errorBody('bad_request', 'Request body must be a JSON object'), 400);
  const input = inputRaw as {
    name?: string;
    parentWorkCenterId?: string | null;
    description?: string | null;
    sortOrder?: number;
    dispatchPolicy?: string;
    autoClaim?: boolean;
    runtimeIdTemplate?: string | null;
    typeName?: string | null;
  };
  if (!input.name || typeof input.name !== 'string') {
    return httpError(c, 400, 'validation', 'name is required');
  }
  if (input.autoClaim !== undefined && typeof input.autoClaim !== 'boolean') {
    return httpError(c, 400, 'validation', 'autoClaim must be a boolean');
  }
  // Explicit guard: this body is CAST into the DAO patch (the documented dispatchParams-leak
  // seam at dao/work-centers.ts), so the type must be checked here, not assumed.
  if (
    input.runtimeIdTemplate !== undefined && input.runtimeIdTemplate !== null &&
    typeof input.runtimeIdTemplate !== 'string'
  ) {
    return httpError(c, 400, 'validation', 'runtimeIdTemplate must be a string or null');
  }
  // Explicit guard: this body is CAST into the DAO patch, and the DAO's normalizeTypeName calls
  // .trim() on trust of the TS type — a non-string must be rejected here, not 500 there.
  if (input.typeName !== undefined && input.typeName !== null && typeof input.typeName !== 'string') {
    return httpError(c, 400, 'validation', 'typeName must be a string or null');
  }
  if (typeof input.typeName === 'string' && input.typeName.trim().length > MAX_TYPE_NAME_LENGTH) {
    return httpError(c, 400, 'validation', TYPE_NAME_TOO_LONG_MESSAGE);
  }
  if (typeof input.runtimeIdTemplate === 'string') {
    const check = validateRuntimeIdTemplate(input.runtimeIdTemplate, { workCenterName: input.name ?? '' });
    if (!check.ok) return httpError(c, 422, 'validation', check.reason);
  }
  try {
    const wc = await createWorkCenter(db, {
      name: input.name,
      parentWorkCenterId: input.parentWorkCenterId ?? null,
      description: input.description ?? null,
      sortOrder: input.sortOrder,
      dispatchPolicy: input.dispatchPolicy,
      autoClaim: input.autoClaim,
      runtimeIdTemplate: input.runtimeIdTemplate,
      typeName: input.typeName ?? null,
    });
    const view = await workCenterView(db, wc.id);
    return c.json(view, 201);
  } catch (err) {
    return sendError(c, err, 'Create failed');
  }
});

workCenterRoutes.patch(
  '/work-centers/:id',
  requireUuidParams('id'),
  requirePermission('work_center:edit'),
  async (c) => {
    const id = c.req.param('id');
    // Typed to match UpdateWorkCenterPatch = Partial<CreateWorkCenterInput>.
    const patchRaw = await readJsonObject(c);
    if (!patchRaw) return c.json(errorBody('bad_request', 'Request body must be a JSON object'), 400);
    const patch = patchRaw as {
      name?: string;
      parentWorkCenterId?: string | null;
      description?: string | null;
      sortOrder?: number;
      dispatchPolicy?: string;
      autoClaim?: boolean;
      runtimeIdTemplate?: string | null;
      typeName?: string | null;
    };
    // Explicit guard because this body is CAST into the DAO patch (the documented
    // dispatchParams-leak seam at dao/work-centers.ts) — never let a non-boolean through.
    if (patch.autoClaim !== undefined && typeof patch.autoClaim !== 'boolean') {
      return httpError(c, 400, 'validation', 'autoClaim must be a boolean');
    }
    // Explicit guard: this body is CAST into the DAO patch (the documented dispatchParams-leak
    // seam at dao/work-centers.ts), so the type must be checked here, not assumed.
    if (
      patch.runtimeIdTemplate !== undefined && patch.runtimeIdTemplate !== null &&
      typeof patch.runtimeIdTemplate !== 'string'
    ) {
      return httpError(c, 400, 'validation', 'runtimeIdTemplate must be a string or null');
    }
    // Explicit guard: this body is CAST into the DAO patch, and the DAO's normalizeTypeName calls
    // .trim() on trust of the TS type — a non-string must be rejected here, not 500 there.
    if (patch.typeName !== undefined && patch.typeName !== null && typeof patch.typeName !== 'string') {
      return httpError(c, 400, 'validation', 'typeName must be a string or null');
    }
    if (typeof patch.typeName === 'string' && patch.typeName.trim().length > MAX_TYPE_NAME_LENGTH) {
      return httpError(c, 400, 'validation', TYPE_NAME_TOO_LONG_MESSAGE);
    }
    if (typeof patch.runtimeIdTemplate === 'string') {
      // The name may be absent from this PATCH body — resolve it from the existing row so the
      // route check validates against the name the work center actually has. The DAO
      // re-validates against the FINAL name (patch.name, if also present) regardless.
      const name = patch.name ?? (await db.select({ name: workCenter.name }).from(workCenter)
        .where(eq(workCenter.id, id)))[0]?.name ?? '';
      const check = validateRuntimeIdTemplate(patch.runtimeIdTemplate, { workCenterName: name });
      if (!check.ok) return httpError(c, 422, 'validation', check.reason);
    }
    try {
      await updateWorkCenter(db, id, patch);
      // Spec 2026-10-09 §8.2/§13: a move changes the work center's inherited Pilot theme (and
      // its subtree's); bumping the rev NOTIFYs the engine so open Pilots refetch.
      if (patch.parentWorkCenterId !== undefined) await bumpThemeRev(db);
      const view = await workCenterView(db, id);
      if (!view) return httpError(c, 404, 'not_found', 'Work center not found');
      return c.json(view);
    } catch (err) {
      return sendError(c, err, 'Update failed');
    }
  },
);

// Two-call delete (spec §8.1). Destroying a work center destroys every artifact loaded into
// it and all of its execution history, so the first call never destroys anything — it
// refuses with the impact summary the confirmation dialog renders. `?confirm=true` then
// performs the ordered teardown.
workCenterRoutes.delete(
  '/work-centers/:id',
  requireUuidParams('id'),
  requirePermission('work_center:delete'),
  async (c) => {
    const id = c.req.param('id');
    // Strict equality, not truthiness: `?confirm=false` must NOT destroy anything.
    const confirmed = c.req.query('confirm') === 'true';
    try {
      await deleteWorkCenter(db, id, { confirmed });
      return c.body(null, 204);
    } catch (err) {
      // The preflight refusal carries the impact summary so the dialog can show the user
      // exactly what a confirmed delete would destroy. Every other DaoError — including
      // WORK_CENTER_HAS_CHILDREN, which no confirmation can override — falls through.
      if (err instanceof DaoError && err.code === 'CONFIRMATION_REQUIRED') {
        const impact = await workCenterDeleteImpact(db, id);
        return c.json({ error: { code: 'conflict', message: err.message, impact } }, 409);
      }
      return sendError(c, err, 'Delete failed');
    }
  },
);

// User assignment survived M6 — only ARTIFACT linking was retired (loading is the linking
// step now). These two lived in routes/links.ts, which P2 deleted wholesale; they are
// restored here because the work center is what they were always scoped to.
//
// The '/work-centers/*' mount only guards :id's shape, so :userId needs its own
// requireUuidParams — otherwise a malformed id reaches the driver and 500s.
workCenterRoutes.post(
  '/work-centers/:id/users/:userId',
  requireUuidParams('userId'),
  requirePermission('work_center:link'),
  async (c) => {
    const id = c.req.param('id');
    // The body is optional here: an absent body means the defaults; a present one must be an object.
    const bodyRaw = (await c.req.text()).trim() === '' ? {} : await readJsonObject(c);
    if (!bodyRaw) return c.json(errorBody('bad_request', 'Request body must be a JSON object'), 400);
    const body = bodyRaw as { priority?: number; missionSystemCommander?: boolean };
    if (body.priority !== undefined && !Number.isFinite(body.priority)) {
      return httpError(c, 400, 'validation', 'priority must be a finite number');
    }
    if (body.missionSystemCommander !== undefined && typeof body.missionSystemCommander !== 'boolean') {
      return httpError(c, 400, 'validation', 'missionSystemCommander must be a boolean');
    }
    try {
      await assignUserToWorkCenter(db, id, c.req.param('userId'),
        { priority: body.priority, missionSystemCommander: body.missionSystemCommander });
      const view = await workCenterView(db, id);
      if (!view) return httpError(c, 404, 'not_found', 'Work center not found');
      return c.json(view);
    } catch (err) {
      return sendError(c, err, 'Assign failed');
    }
  },
);

// Idempotent by construction (a DELETE over a missing row affects nothing), which is what
// lets the dialog fire it optimistically without special-casing a double click.
workCenterRoutes.delete(
  '/work-centers/:id/users/:userId',
  requireUuidParams('userId'),
  requirePermission('work_center:link'),
  async (c) => {
    await removeUserFromWorkCenter(db, c.req.param('id'), c.req.param('userId'));
    return c.body(null, 204);
  },
);

// Spec 2026-09-06 D3/D4: the ONLY role-editing surface. Whole-set replace, same right as the
// rest of the Users tab (assign / unassign / Mission System Commander).
workCenterRoutes.put(
  '/work-centers/:id/users/:userId/roles',
  requireUuidParams('userId'),
  requirePermission('work_center:link'),
  async (c) => {
    const id = c.req.param('id');
    // The body is optional here: an absent body means the defaults; a present one must be an object.
    const bodyRaw = (await c.req.text()).trim() === '' ? {} : await readJsonObject(c);
    if (!bodyRaw) return c.json(errorBody('bad_request', 'Request body must be a JSON object'), 400);
    const body = bodyRaw as { roleIds?: unknown };
    if (!Array.isArray(body.roleIds) || body.roleIds.length > 200
      || !body.roleIds.every((r) => typeof r === 'string' && isUuid(r))) {
      return httpError(c, 400, 'validation', 'roleIds must be an array of at most 200 role UUIDs');
    }
    try {
      await setWorkCenterUserRoles(db, id, c.req.param('userId'), body.roleIds);
      const view = await workCenterView(db, id);
      if (!view) return httpError(c, 404, 'not_found', 'Work center not found');
      return c.json(view);
    } catch (err) {
      return sendError(c, err, 'Role update failed');
    }
  },
);

// ── Phase 4b (spec §7.2): operator writes — thin commander-gated proxies to the engine's
// registry verbs (spec §7.1). The work center IS the subject, so the commander resolver only
// confirms it exists (null → 404, requireMissionSystemCommander's rule). The environment pane posts
// here too: it has no state of its own to write. `actorUserId` is always the session principal
// — never the body — because it stamps wc_value_property.updated_by and the operator trace.

const workCenterIdIfExists = async (id: string): Promise<string | null> => ((await workCenterExists(db, id)) ? id : null);

for (const verb of RESOURCE_VERBS) {
  workCenterRoutes.post(
    `/work-centers/:id/resources/${verb}`,
    requireUuidParams('id'),
    // Non-null: ':id' is mandatory in the pattern (runtime-workflows.ts's rationale).
    requireMissionSystemCommander((c) => workCenterIdIfExists(c.req.param('id')!)),
    async (c) => {
      const parsed = workCenterResourceVerbBody.safeParse(await c.req.json().catch(() => ({})));
      if (!parsed.success) return httpError(c, 400, 'validation', 'Invalid resource verb payload');
      const id = c.req.param('id');
      const actorUserId = c.get('principal').userId;
      return proxyEngine(c, () => engineWorkCenterResourceVerb(id, verb, { ...parsed.data, actorUserId }), `${verb} failed`);
    },
  );
}

workCenterRoutes.post(
  '/work-centers/:id/value-properties',
  requireUuidParams('id'),
  // Non-null: ':id' is mandatory in the pattern.
  requireMissionSystemCommander((c) => workCenterIdIfExists(c.req.param('id')!)),
  async (c) => {
    const parsed = workCenterValueBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return httpError(c, 400, 'validation', 'Invalid value payload');
    const id = c.req.param('id');
    const actorUserId = c.get('principal').userId;
    return proxyEngine(c, () => engineSetWorkCenterValue(id, { ...parsed.data, actorUserId }), 'Value update failed');
  },
);

// Spec 2026-10-09 §8–§11: a work center's Pilot theme override. Reading is work_center:read;
// writing is administrator-only (R7). Checks run on the FULLY MERGED theme (site + ancestors +
// this); a save that breaks a descendant's own override succeeds and names it.
async function themeView(id: string) {
  const [{ rev, site }, chain] = await Promise.all([readSiteTheme(db), readThemeChain(db, id)]);
  return chain ? { rev, site, chain } : null;
}

workCenterRoutes.get(
  '/work-centers/:id/pilot-theme',
  requireUuidParams('id'),
  requirePermission('work_center:read'),
  async (c) => {
    const view = await themeView(c.req.param('id'));
    if (!view) return httpError(c, 404, 'not_found', 'Work center not found');
    return c.json(view);
  },
);

workCenterRoutes.put(
  '/work-centers/:id/pilot-theme',
  requireUuidParams('id'),
  requirePermission('work_center:edit'),
  async (c) => {
    if (c.get('principal').accessLevel !== 'administrator') {
      return httpError(c, 403, 'forbidden', 'Work-center branding requires an administrator');
    }
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => null)) as { pilotTheme?: unknown } | null;
    if (!body || body.pilotTheme === undefined) {
      return httpError(c, 422, 'validation', 'pilotTheme is required (null clears every override)');
    }
    let theme: PilotTheme | null = null;
    if (body.pilotTheme !== null) {
      const parsed = parseTheme(body.pilotTheme, { strict: true });
      if (!parsed.ok) return httpError(c, 422, 'validation', `pilotTheme: ${parsed.errors.join('; ')}`);
      const missing = await missingBrandAssets(db, parsed.theme);
      if (missing.length > 0) return httpError(c, 422, 'validation', `pilotTheme: no such brand asset: ${missing.join(', ')}`);
      theme = parsed.theme;
    }
    const current = await themeView(id);
    if (!current) return httpError(c, 404, 'not_found', 'Work center not found');
    const ancestors = current.chain.slice(0, -1).map((l) => l.theme);
    // Only failures THIS layer adds block the save (final review): one a later site change
    // already caused in the layers beneath (safeResolve covers it at runtime, the site save
    // named it) must not stop a child from editing or clearing its own branding.
    const pairKey = (f: { mode: string; fg: string; bg: string }) => `${f.mode}|${f.fg}|${f.bg}`;
    const inherited = new Set(checkContrast(resolveTheme([current.site, ...ancestors])).failures.map(pairKey));
    const failures = checkContrast(resolveTheme([current.site, ...ancestors, theme ?? { schema: 1 }])).failures
      .filter((f) => !inherited.has(pairKey(f)));
    if (failures.length > 0) {
      return httpError(c, 422, 'validation', `Work-center branding fails the contrast checks: ${failures.map(describeFailure).join('; ')}`);
    }
    try {
      await writeWorkCenterTheme(db, id, theme);
    } catch (err) {
      return sendError(c, err, 'Save failed');
    }
    const [after, broken] = await Promise.all([themeView(id), brokenWorkCenterThemes(db, { under: id })]);
    if (!after) return httpError(c, 404, 'not_found', 'Work center not found');
    return c.json({ ...after, broken });
  },
);
