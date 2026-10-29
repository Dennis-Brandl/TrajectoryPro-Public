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
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { eq } from 'drizzle-orm';
import { db } from './lib/db';
import { appUser } from 'mission-control-db/src/db/schema/index';
import { auth } from './lib/auth';
import { clientIpMiddleware, parseTrustedProxies } from './lib/client-ip';
import { signupGate } from './middleware/signup-gate';
import { adminGate } from './middleware/admin-gate';
import { meRoutes } from './routes/me';
import { workCenterRoutes } from './routes/work-centers';
import { workflowRoutes } from './routes/workflows';
import { runtimeWorkflowRoutes } from './routes/runtime-workflows';
import { runtimeHistoryRoutes } from './routes/runtime-history';
import { environmentBindingRoutes } from './routes/environment-bindings';
import { controlGrantRoutes } from './routes/control-grants';
import { environmentRoutes } from './routes/environments';
import { loadRoutes } from './routes/load';
import { pickerRoutes } from './routes/pickers';
import { usersRoutes } from './routes/users';
import { rolesRoutes } from './routes/roles';
import { allowedRolesRoutes } from './routes/allowed-roles';
import { packageRoutes } from './routes/package';
import { systemSettingsRoutes } from './routes/system-settings';
import { brandAssetRoutes } from './routes/brand-assets';
import { sendDaoError } from './lib/errors';

export const app = new Hono();

// The package routes (and any future handler) deliberately let a DaoError propagate instead
// of catching it locally, so this is the one place that maps it to its HTTP status — via the
// same DAO_STATUS table every other route's try/catch + sendError() already uses. Anything
// that isn't a DaoError falls through to the generic 500 below.
app.onError((err, c) => {
  const daoResponse = sendDaoError(c, err);
  if (daoResponse) return daoResponse;
  console.error(`[unhandled] ${c.req.method} ${c.req.path}:`, err);
  return c.json({ error: { code: 'internal', message: 'Internal error' } }, 500);
});

app.use('*', logger());
app.use(
  '/api/*',
  cors({
    origin: (origin) => {
      if (!origin) return origin;
      try {
        const host = new URL(origin).hostname;
        if (host === 'localhost' || host === '127.0.0.1') return origin;
      } catch {
        /* invalid origin */
      }
      const allowed = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim());
      return allowed.includes(origin) ? origin : null;
    },
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);

// Both gates mount on the full /api/auth/* prefix (not narrower /sign-up/* or /admin/*):
// Hono only enters a path-scoped middleware when a literal '/' follows the scope segment in
// the raw path, so an encoded separator (sign-up%2Femail, admin%2Fremove-user) skips a
// narrower mount entirely — no in-handler canonicalization can run if the handler is never
// invoked. The broad mount guarantees each gate sees every request that could reach the auth
// handler; isSignupPath()/isBlockedAdminPath() then do the exact matching (spec §5, §6.3).
// First on /api/auth/*: better-auth's rate limit keys on the client IP this sets.
app.use('/api/auth/*', clientIpMiddleware(parseTrustedProxies(process.env.TRUSTED_PROXIES)));
app.use('/api/auth/*', signupGate); // must precede adminGate + the auth handler
app.use('/api/auth/*', adminGate); // default-closed admin allowlist (spec §6.3)
app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));

app.get('/api/health', (c) => c.json({ status: 'ok' }));

app.route('/api', meRoutes);
app.route('/api', workCenterRoutes);
app.route('/api', workflowRoutes);
app.route('/api', runtimeWorkflowRoutes);
app.route('/api', runtimeHistoryRoutes);
app.route('/api', environmentBindingRoutes);
app.route('/api', controlGrantRoutes);
app.route('/api', environmentRoutes);
app.route('/api', loadRoutes);
app.route('/api', pickerRoutes);
app.route('/api', usersRoutes);
app.route('/api', rolesRoutes);
app.route('/api', allowedRolesRoutes);
app.route('/api', packageRoutes);
app.route('/api', systemSettingsRoutes);
app.route('/api', brandAssetRoutes);

app.get('/api/setup-status', async (c) => {
  const [admin] = await db
    .select({ id: appUser.id })
    .from(appUser)
    .where(eq(appUser.accessLevel, 'administrator'))
    .limit(1);
  return c.json({ setupComplete: !!admin });
});

app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Not found' } }, 404));
