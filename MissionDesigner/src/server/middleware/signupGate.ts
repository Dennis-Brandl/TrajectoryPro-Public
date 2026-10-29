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

import type { Hono } from 'hono'

/**
 * Close public sign-up once the install is bootstrapped (design D6 / spec §4.2).
 *
 * Route-level middleware on `/api/auth/sign-up/*` that returns 403 once
 * `setupComplete` is true. While the database is un-bootstrapped it passes
 * through, so the first-run wizard (Step 2) can create the first administrator
 * via the public sign-up route (the auto-promote hook then elevates them).
 *
 * MUST be route-level — NOT a better-auth `databaseHooks.user.create.before`
 * hook — because admin-initiated user creation (spec §5.2) calls better-auth's
 * server adapter directly and never touches the public route, so it bypasses
 * this gate.
 *
 * `isComplete` is injected so tests can drive it; production passes an async thunk
 * over the live database: `async () => isSetupComplete()`.
 */
export function mountSignupGate(app: Hono, isComplete: () => boolean | Promise<boolean>): void {
  app.use('/api/auth/sign-up/*', async (c, next) => {
    if (await isComplete()) {
      return c.json({ code: 'signup_closed' }, 403)
    }
    return next()
  })
}
