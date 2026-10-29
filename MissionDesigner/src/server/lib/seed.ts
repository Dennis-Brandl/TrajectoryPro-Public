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

import { eq } from 'drizzle-orm'
import { db } from './db'
import { user } from '../db/schema'

/**
 * Check whether at least one administrator account exists.
 */
export async function hasAdminAccount(): Promise<boolean> {
  const [admin] = await db.select({ id: user.id }).from(user).where(eq(user.isAdministrator, true)).limit(1)
  return !!admin
}

/**
 * Promote a user to administrator (design D14: implicit all-rights-all-teams).
 * Called automatically when the first account is registered and no admin exists.
 */
export async function promoteToAdmin(userId: string): Promise<void> {
  await db.update(user).set({ isAdministrator: true }).where(eq(user.id, userId))
  console.log(`Promoted user ${userId} to admin (first account)`)
}
