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

// Session helpers for the post-/setup auth model. global-setup.ts bootstraps the
// first admin and persists its storageState (cookies) + the bootstrap ids; specs
// reuse those instead of registering through the (now removed) UI. signIn mints a
// storageState for any additional user (e.g. the RBAC personas in later phases).

import type { APIRequestContext } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** API server the E2E harness boots on. */
const API_BASE = 'http://localhost:3001'
/** Origin the dev origin/CORS layer trusts — Vite's dev port. */
const ORIGIN = 'http://localhost:5174'

/** The first admin global-setup.ts bootstraps; auth.spec.ts logs in as this user. */
export const ADMIN_CREDENTIALS = {
  email: 'e2e-admin@trajectory-e2e.test',
  password: 'AdminPass123!',
  name: 'E2E Admin',
}

/** Persisted admin storageState (cookies) written by global-setup.ts. */
export const ADMIN_STORAGE_STATE = 'e2e/.auth/admin.json'
/** Persisted bootstrap ids written by global-setup.ts. */
const STATE_FILE = 'e2e/.auth/state.json'

export interface BootstrapState {
  adminUserId: string
  defaultTeamId: string
}

/**
 * Sign a user in via the better-auth email/password route on the passed context,
 * then return that context's storageState (cookies) for reuse. Pass a FRESH
 * APIRequestContext per user so cookies don't mix.
 */
export async function signIn(
  request: APIRequestContext,
  opts: { email: string; password: string },
): Promise<Awaited<ReturnType<APIRequestContext['storageState']>>> {
  const res = await request.post(`${API_BASE}/api/auth/sign-in/email`, {
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    data: { email: opts.email, password: opts.password },
  })
  if (!res.ok()) {
    const body = await res.text()
    throw new Error(`signIn failed: ${res.status()} ${body}`)
  }
  return request.storageState()
}

/** Read the bootstrap output (ids + admin storageState path) persisted by global-setup.ts. */
export function loadAdminState(): BootstrapState & { storageState: string } {
  const raw = readFileSync(resolve(process.cwd(), STATE_FILE), 'utf8')
  const state = JSON.parse(raw) as BootstrapState
  return { ...state, storageState: ADMIN_STORAGE_STATE }
}
