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

import { eq } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { appUser } from '../db/schema/index.js';
import type { Schema } from '../db/client.js';

type Db = PgDatabase<any, Schema>;

/** Shown wherever a disabled account is refused (Commander login, Pilot login). Pilot inlines this string. */
export const ACCOUNT_DISABLED_MESSAGE = 'This account is disabled. Ask an administrator to enable it.';

/** True only for a user that exists and has status 'disabled'. An unknown id is not "disabled". */
export async function isUserDisabled(db: Db, userId: string): Promise<boolean> {
  const [row] = await db.select({ status: appUser.status }).from(appUser).where(eq(appUser.id, userId));
  return row?.status === 'disabled';
}
