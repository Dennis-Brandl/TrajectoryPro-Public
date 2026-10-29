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
import fs from 'node:fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { app } from './app';
import { secretProblems } from './lib/secret-policy';
import { canonicalHost } from './middleware/canonical-host';
import { db } from './lib/db';
import { startAuthPurge } from './lib/auth-purge';

const port = Number(process.env.PORT) || 3002;

// In production, set BASE_URL to the server's full public origin — it falls back to
// http://localhost:3002 otherwise, and lib/auth.ts passes baseURL explicitly, which
// overrides better-auth's native BETTER_AUTH_URL.
const problems = secretProblems(process.env);
if (problems.length > 0) {
  for (const p of problems) console.error(`FATAL: ${p}`);
  console.error('FATAL: Run scripts/setup-secrets.sh, then recreate Mission Commander.');
  process.exit(1);
}

// Serve the built frontend when one is present (the container image builds Vite's
// output into ./public). Mounted HERE rather than in app.ts so the API routes are
// already registered — serveStatic would otherwise shadow them — and so app.ts stays
// the pure API surface its tests exercise. In dev this block is inert: Vite serves the
// frontend on :5273 and proxies /api here (vite.config.ts).
if (fs.existsSync('./public/index.html')) {
  // Pin the SPA to ONE loopback hostname before serving it. `localhost` and `127.0.0.1`
  // reach the same server but are separate cookie hosts, so signing in on one and
  // returning on the other sends no session cookie: every /api call 401s and the app looks
  // empty while the data is untouched. Mounted HERE, alongside the static SPA, so it only
  // applies where a browser actually loads the app from this server — in dev and e2e Vite
  // serves the SPA and this block is inert.
  app.use('*', canonicalHost(process.env.BASE_URL));
  app.use('*', serveStatic({ root: './public' }));
  // SPA fallback: TanStack Router owns client-side routing, so any unmatched path that
  // is not an API call must return index.html rather than a 404 — otherwise a deep link
  // or a page refresh on /work-centers breaks.
  app.notFound((c) => {
    if (c.req.path.startsWith('/api/')) {
      return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
    }
    return c.html(fs.readFileSync('./public/index.html', 'utf-8'));
  });
}

serve({ fetch: app.fetch, port }, () => {
  console.log(`Mission Commander listening on :${port}`);
});

if (process.env.NODE_ENV !== 'test') startAuthPurge(db);
