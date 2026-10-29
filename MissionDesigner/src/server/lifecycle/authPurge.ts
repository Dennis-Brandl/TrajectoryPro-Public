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

import { rawQuery } from '../lib/db'

/** Delete session and verification rows whose expiresAt is before `now` (epoch ms). */
export async function purgeExpiredAuthRows(now: number): Promise<{ sessions: number; verifications: number }> {
  const sessions = await rawQuery(
    'DELETE FROM "session" WHERE "expiresAt" < to_timestamp($1 / 1000.0) RETURNING "id"',
    [now],
  )
  const verifications = await rawQuery(
    'DELETE FROM "verification" WHERE "expiresAt" < to_timestamp($1 / 1000.0) RETURNING "id"',
    [now],
  )
  return { sessions: sessions.length, verifications: verifications.length }
}

/** Timer body: purge now, log and swallow any failure. */
export async function runAuthPurge(): Promise<void> {
  try {
    await purgeExpiredAuthRows(Date.now())
  } catch (err) {
    console.error('[authPurge] failed:', err)
  }
}
