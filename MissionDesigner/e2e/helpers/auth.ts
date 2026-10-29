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

import type { APIRequestContext, BrowserContext } from '@playwright/test'

export interface SeededAdmin {
  userId: string
  email: string
  password: string
  name: string
  storageState: Awaited<ReturnType<APIRequestContext['storageState']>>
}

/** API server the E2E harness boots on. */
const API_BASE = 'http://localhost:3001'
/** Origin the dev origin/CORS layer trusts — Vite's dev port. */
const ORIGIN = 'http://localhost:5174'

/**
 * Bootstrap the FIRST admin on a fresh, un-bootstrapped DB.
 *
 * On an empty DB the public sign-up route is open (the route-level signupGate
 * only 403s once setupComplete), and the better-auth databaseHooks.user.create
 * .after hook auto-promotes the first user to administrator — so no direct DB
 * write is needed (the retired user-level flags are gone; capability is now team
 * roles). Signs in afterwards and returns the resulting storageState (cookies).
 *
 * Must run before /api/v2/admin/setup-complete; every later user is created via
 * the admin REST surface (helpers/admin.ts createUser), which bypasses the gate.
 */
export async function bootstrapFirstAdmin(
  request: APIRequestContext,
  opts: { email: string; password: string; name: string },
): Promise<SeededAdmin> {
  const signUpRes = await request.post(`${API_BASE}/api/auth/sign-up/email`, {
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    data: { email: opts.email, password: opts.password, name: opts.name },
  })
  if (!signUpRes.ok()) {
    const body = await signUpRes.text()
    throw new Error(`sign-up failed: ${signUpRes.status()} ${body}`)
  }
  const signUpBody = (await signUpRes.json()) as { user?: { id: string } }
  const userId = signUpBody.user?.id
  if (!userId) throw new Error(`sign-up response missing user.id: ${JSON.stringify(signUpBody)}`)

  // Sign in to obtain a session cookie now that the auto-promote hook has run.
  // (better-auth requires an Origin header — CSRF protection.)
  const signInRes = await request.post(`${API_BASE}/api/auth/sign-in/email`, {
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    data: { email: opts.email, password: opts.password },
  })
  if (!signInRes.ok()) {
    const body = await signInRes.text()
    throw new Error(`sign-in failed: ${signInRes.status()} ${body}`)
  }

  const storageState = await request.storageState()
  return { userId, email: opts.email, password: opts.password, name: opts.name, storageState }
}

/** Inject the seeded admin's cookies into a Playwright BrowserContext. */
export async function applyAuthToContext(context: BrowserContext, admin: SeededAdmin): Promise<void> {
  // storageState cookies include domain/path already.
  await context.addCookies(admin.storageState.cookies)
}
