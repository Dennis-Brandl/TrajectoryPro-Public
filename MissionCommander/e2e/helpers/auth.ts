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
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { API_BASE_URL, APP_BASE_URL, ADMIN } from './db';

/**
 * Mirrors Studio's "bootstrap the first admin" e2e pattern, adapted to this repo's
 * actual startup order: playwright.config.ts's API webServer command runs
 * `npm run seed` (idempotent — src/server/seed.ts) BEFORE the server starts serving
 * requests, so in the normal flow admin@command.local already exists by the time any
 * spec — including this call — runs.
 *
 * POSTs directly to the API server's /api/auth/sign-up/email (bypassing the Vite
 * proxy entirely, since no `page` navigation has happened yet) with an `Origin` header
 * naming the SPA's origin. better-auth's origin-check middleware validates that header
 * against `trustedOrigins` for any request carrying one (see lib/auth.ts) — this is
 * also why playwright.config.ts's API webServer sets ALLOWED_ORIGINS to APP_BASE_URL:
 * without it this POST (and, more importantly, every real browser sign-in from the SPA
 * at :5274 later in each spec) would be rejected 403 "Invalid origin".
 *
 * Two outcomes both count as success, by design — this helper is gate-tolerant:
 *   - 2xx: the e2e database had no administrator yet, so this call created the
 *     first-ever account, which lib/auth.ts's databaseHooks promotes to administrator.
 *     Not the normal path here (seed already runs first) but kept working in case the
 *     startup order ever changes, or the helper is reused against a fresh DB elsewhere.
 *   - 403: the NORMAL case in this repo's e2e flow — `npm run seed` already created
 *     admin@command.local as the first admin, so middleware/signup-gate.ts closes
 *     public sign-up (returns 403) before better-auth's handler is even invoked.
 * Any other status is a genuine failure and throws.
 */
export async function bootstrapFirstAdmin(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${API_BASE_URL}/api/auth/sign-up/email`, {
    headers: { Origin: APP_BASE_URL },
    data: { email: ADMIN.email, password: ADMIN.password, name: 'Demo Administrator' },
  });
  if (res.ok() || res.status() === 403) return;
  throw new Error(`bootstrapFirstAdmin: unexpected ${res.status()} from sign-up/email: ${await res.text()}`);
}

/**
 * Drives a real browser sign-in through LoginPage (goto /login → fill Email/Password →
 * click Sign In → await the post-login "Sign out" control), shared by every spec that
 * needs an authenticated session. Previously copy-pasted verbatim across the three e2e
 * spec files; extracted here so the flow — and its 15s timeout, needed because the
 * first sign-in of a run can be slow behind cold webServer startup — is defined once.
 */
export async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible({ timeout: 15_000 });
}
