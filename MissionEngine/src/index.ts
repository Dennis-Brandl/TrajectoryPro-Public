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

// src/index.ts — boot: config -> db -> app (health + operator API + static) -> loop -> listeners
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { loadConfig, type EngineDeps } from './config.js';
import { createDb } from './db.js';
import { healthApp } from './health.js';
import { startLoop } from './loop.js';
import { createWakeListener } from './wake.js';
import { httpActionInvoker } from './actions/invoker.js';
import { ActionClient } from './actions/client.js';
import { cachedPolicySource } from './actions/policy-cache.js';
import { getEnvironmentBinding } from 'mission-control-db/src/dao/environment-bindings';
import { getActionServerPolicy, seedActionServerAllowlistIfAbsent } from 'mission-control-db/src/dao/system-settings';
import { NOTIFY_GRANT_CHANNEL } from 'mission-control-db/src/runtime/wc-resources';
import { createAuth } from './api/auth.js';
import { createApiApp } from './api/app.js';
import { createInternalApp } from './api/internal.js';
import { OperatorEventHub } from './api/events.js';
import { OPERATOR_CHANGE_CHANNEL } from './core/reconcile.js';
import { PILOT_THEME_CHANNEL } from 'mission-control-db/src/dao/pilot-theme-store';
import { startPropertyWatch } from './core/property-watch.js';
import { installScriptRejectionGuard } from './core/step-handlers.js';

// A SCRIPT or GATE that leaves a promise rejected must not take the engine down (Node's default
// for an unhandled rejection is to exit); the engine's own rejections still do.
installScriptRejectionGuard();

const cfg = loadConfig(process.env);
const { db } = createDb(cfg.databaseUrl);

// Spec 2026-09-05 decision B: ACTION_SERVER_ALLOWLIST seeds the Mission Commander's list on first
// boot only. A failed seed must not stop the engine from booting — the policy read fails closed
// (strict + empty) until the row exists, and the next boot retries the seed.
try {
  if (await seedActionServerAllowlistIfAbsent(db, cfg.actionServerAllowlist)) {
    const { allowlist } = await getActionServerPolicy(db);
    console.log(`[mission-engine] seeded action_server_allowlist from ACTION_SERVER_ALLOWLIST (${allowlist.length} origin(s))`);
  }
} catch (err) {
  console.error(`[mission-engine] action_server_allowlist seed failed (continuing; policy reads fail closed): ${err instanceof Error ? err.message : String(err)}`);
}
const actionClient = new ActionClient(cachedPolicySource(() => getActionServerPolicy(db)), fetch, { timeoutMs: cfg.actionFetchTimeoutMs, broker: cfg.broker, actions: cfg.actions });
const invoker = httpActionInvoker(actionClient, (workCenterId, environmentOid) =>
  getEnvironmentBinding(db, workCenterId, environmentOid));
const deps: EngineDeps = { config: cfg, invoker, now: () => new Date() };

const auth = createAuth(db, { baseURL: cfg.baseUrl, secret: cfg.authSecret });
const hub = new OperatorEventHub(db);

const app = new Hono();
// Canonical-host redirect (M5 cookie-jar lesson): browsers keep separate cookie jars for
// localhost and 127.0.0.1; steer GETs to the configured base host before auth ever runs.
const canonical = new URL(cfg.baseUrl);
app.use('*', async (c, next) => {
  const host = c.req.header('host');
  if (c.req.method === 'GET' && host && host !== canonical.host && !c.req.path.startsWith('/api/')) {
    const search = new URL(c.req.url).search;
    return c.redirect(`${canonical.protocol}//${canonical.host}${c.req.path}${search}`, 302);
  }
  return next();
});
app.route('/', healthApp);
app.route('/', createApiApp(db, deps, auth, hub));
app.route('/', createInternalApp(db, deps, hub));
// Pilot bundle (Plan B fills ./public; absent in dev -> 404s, harmless).
// Cache discipline (user-testing bug: a long-lived Pilot tab kept executing a
// pre-deploy bundle because nothing ever told the browser to revalidate):
// hashed /assets/* are content-addressed -> cache forever; the HTML shell must
// be revalidated on every navigation so a rebuild propagates on next load.
app.use('/assets/*', async (c, next) => {
  await next();
  if (c.res.ok) c.res.headers.set('cache-control', 'public, max-age=31536000, immutable');
});
app.use('/*', async (c, next) => {
  await next();
  if (c.res.ok && (c.res.headers.get('content-type') ?? '').includes('text/html')
    && !c.res.headers.has('cache-control')) {
    c.res.headers.set('cache-control', 'no-cache');
  }
});
app.use('/*', serveStatic({ root: './public' }));
app.get('*', serveStatic({ path: './public/index.html' }));

serve({ fetch: app.fetch, port: cfg.port }, () => {
  console.log(`mission-engine on :${cfg.port}`);
});

const loop = startLoop(db, deps);
// Spec 2026-09-14 §4.7: REST-12 property events pull a waiting bound gate's wake_at to now and
// wake the loop; the loop hands "something happened" back through onWorkDone so the registry
// re-reads WAITING_GATE rows promptly (debounced) instead of only on its reconcile timer.
const watch = startPropertyWatch(db, deps, actionClient, loop.wake);
deps.onWorkDone = watch.reconcileSoon;
createWakeListener(cfg.databaseUrl, loop.wake);
createWakeListener(cfg.databaseUrl, (payload) => { if (payload) hub.notifyWorkCenter(payload); }, OPERATOR_CHANGE_CHANNEL);
// Spec 2026-10-09 §13: Commander bumps pilot_theme_rev and NOTIFYs it in the same transaction
// as a theme save; every open Pilot gets `event: theme` and refetches /api/theme.
createWakeListener(cfg.databaseUrl, (payload) => {
  const rev = Number(payload);
  if (Number.isSafeInteger(rev)) hub.notifyTheme(rev);
}, PILOT_THEME_CHANNEL);
// Phase 2a (Task 5): a release by one instance can make a DIFFERENT instance's queued
// environment-resource Acquire grantable — wake every idle worker slot immediately so it claims
// that instance promptly rather than waiting for its next idle sweep (wc-resources.ts's
// NOTIFY_GRANT_CHANNEL doc comment). No payload handling needed: the wake itself is enough,
// same as the default engine_wake channel above.
createWakeListener(cfg.databaseUrl, loop.wake, NOTIFY_GRANT_CHANNEL);

// Spec 2026-09-14 §4.7: close the property streams before the loop stops. Node's default
// SIGTERM/SIGINT disposition is an immediate exit; this handler keeps that (process.exit) and
// only puts the orderly stream close in front of it, so Autopilot sees a clean disconnect.
const shutdown = (): void => {
  watch.stop();
  loop.stop();
  process.exit(0);
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
