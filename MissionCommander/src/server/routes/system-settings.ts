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
//
// System-wide settings (spec 2026-08-20; widened 2026-09-05 for the action-server trust
// mode + allowlist). Keys: action matching mode, action-server trust, allowlist, and
// (spec 2026-10-09 §8.3) the site Pilot theme.
import { Hono } from 'hono';
import { db } from '../lib/db';
import {
  getActionMatchingMode, setActionMatchingMode,
  getActionServerPolicy, setActionServerTrust, setActionServerAllowlist, normalizeActionServerOrigin,
} from 'mission-control-db/src/dao/system-settings';
import {
  parseTheme, resolveTheme, checkContrast, describeFailure, type PilotTheme,
} from 'mission-control-db/src/dao/pilot-theme';
import { readSiteTheme, writeSiteTheme } from 'mission-control-db/src/dao/pilot-theme-store';
import { brokenWorkCenterThemes, missingBrandAssets } from 'mission-control-db/src/dao/pilot-theme-chain';
import { requireSession, requirePermission, type Vars } from '../middleware/auth';
import { httpError } from '../lib/errors';

export const systemSettingsRoutes = new Hono<{ Variables: Vars }>();

systemSettingsRoutes.use('/system-settings', requireSession);

async function readAll() {
  const [actionMatching, policy, pilotTheme] = await Promise.all([
    getActionMatchingMode(db), getActionServerPolicy(db), readSiteTheme(db),
  ]);
  return { actionMatching, actionServerTrust: policy.trust, actionServerAllowlist: policy.allowlist, pilotTheme };
}

systemSettingsRoutes.get('/system-settings', requirePermission('settings:read'), async (c) => c.json(await readAll()));

systemSettingsRoutes.put('/system-settings', requirePermission('settings:edit'), async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    { actionMatching?: unknown; actionServerTrust?: unknown; actionServerAllowlist?: unknown; pilotTheme?: unknown } | null;
  if (!body || (body.actionMatching === undefined && body.actionServerTrust === undefined
    && body.actionServerAllowlist === undefined && body.pilotTheme === undefined)) {
    return httpError(c, 422, 'validation', 'nothing to update');
  }
  // Spec 2026-10-09 §8.3 (R7): branding is administrator-only even for holders of
  // settings:edit. Checked before validation so a non-administrator learns nothing more.
  if (body.pilotTheme !== undefined && c.get('principal').accessLevel !== 'administrator') {
    return httpError(c, 403, 'forbidden', 'Pilot branding requires an administrator');
  }
  if (body.actionMatching !== undefined && body.actionMatching !== 'loose' && body.actionMatching !== 'strict') {
    return httpError(c, 422, 'validation', "actionMatching must be 'loose' or 'strict'");
  }
  if (body.actionServerTrust !== undefined && body.actionServerTrust !== 'strict' && body.actionServerTrust !== 'loose') {
    return httpError(c, 422, 'validation', "actionServerTrust must be 'strict' or 'loose'");
  }
  let origins: string[] | undefined;
  if (body.actionServerAllowlist !== undefined) {
    if (!Array.isArray(body.actionServerAllowlist) || body.actionServerAllowlist.length > 50) {
      return httpError(c, 422, 'validation', 'actionServerAllowlist must be an array of at most 50 origins');
    }
    origins = [];
    for (let i = 0; i < body.actionServerAllowlist.length; i++) {
      const raw = body.actionServerAllowlist[i];
      const parsed = typeof raw === 'string' ? normalizeActionServerOrigin(raw) : { ok: false as const, reason: 'must be a string' };
      if (!parsed.ok) return httpError(c, 422, 'validation', `actionServerAllowlist[${i}]: ${parsed.reason}`);
      origins.push(parsed.origin);
    }
  }
  // Spec §7/§11: strict parse (unknown fields and bad values rejected), then the hard
  // contrast checks on the merged result — the editor runs the same code live, so a 422
  // here means a client that skipped it.
  let pilotTheme: PilotTheme | undefined;
  if (body.pilotTheme !== undefined) {
    const parsed = parseTheme(body.pilotTheme, { strict: true });
    if (!parsed.ok) return httpError(c, 422, 'validation', `pilotTheme: ${parsed.errors.join('; ')}`);
    const missing = await missingBrandAssets(db, parsed.theme);
    if (missing.length > 0) return httpError(c, 422, 'validation', `pilotTheme: no such brand asset: ${missing.join(', ')}`);
    const { failures } = checkContrast(resolveTheme([parsed.theme]));
    if (failures.length > 0) {
      return httpError(c, 422, 'validation', `Pilot branding fails the contrast checks: ${failures.map(describeFailure).join('; ')}`);
    }
    pilotTheme = parsed.theme;
  }
  // Finding #6 (Important): stewards hold settings:edit (so action matching stays theirs to
  // flip), but the Action Server binding the allowlist constrains is requireAdministrator —
  // a non-administrator must never be able to change the trust mode or the allowlist.
  if ((body.actionServerTrust !== undefined || body.actionServerAllowlist !== undefined)
    && c.get('principal').accessLevel !== 'administrator') {
    return httpError(c, 403, 'forbidden', 'Action server trust and the allowlist require an administrator');
  }
  // Hoisted to locals: TS's control-flow narrowing of a property read (body.actionMatching /
  // body.actionServerTrust, both validated above) does not survive being re-read inside the
  // nested transaction closure below — a plain local const keeps the narrowed literal type.
  const matching = body.actionMatching;
  const trustToSet = body.actionServerTrust;
  await db.transaction(async (tx) => {
    if (matching !== undefined) await setActionMatchingMode(tx, matching);
    if (trustToSet !== undefined) await setActionServerTrust(tx, trustToSet);
    if (origins !== undefined) await setActionServerAllowlist(tx, origins);
    // Stores the theme, bumps pilot_theme_rev and NOTIFYs the engine (P2a) — on commit.
    if (pilotTheme !== undefined) await writeSiteTheme(tx, pilotTheme);
  });
  // Spec §11: a site change that breaks a work center's own override still saves; name them.
  if (pilotTheme !== undefined) {
    return c.json({ ...(await readAll()), pilotThemeBrokenWorkCenters: await brokenWorkCenterThemes(db) });
  }
  return c.json(await readAll());
});
