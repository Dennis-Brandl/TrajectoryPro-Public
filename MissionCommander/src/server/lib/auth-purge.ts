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
import { lt } from 'drizzle-orm';
import { session, verification } from 'mission-control-db/src/db/schema/index';
import type { Db } from './db';

const FIRST_RUN_MS = 60_000;
const INTERVAL_MS = 86_400_000;

/** Deletes sessions and verification rows whose expiry has passed. The shared
 *  mission_control tables are never otherwise cleaned, so they only grow. */
export async function purgeExpiredAuthRows(
  database: Db,
  now: Date,
): Promise<{ sessions: number; verifications: number }> {
  const sessions = await database
    .delete(session)
    .where(lt(session.expiresAt, now))
    .returning({ id: session.id });
  const verifications = await database
    .delete(verification)
    .where(lt(verification.expiresAt, now))
    .returning({ id: verification.id });
  return { sessions: sessions.length, verifications: verifications.length };
}

/** Purges once a minute after start, then daily. Timers are unref'd so they never keep the process alive. */
export function startAuthPurge(database: Db): void {
  const run = () => {
    // Promise.resolve().then catches a synchronous throw as well as a rejection.
    Promise.resolve()
      .then(() => purgeExpiredAuthRows(database, new Date()))
      .catch((err) => console.error('[auth-purge] failed:', err));
  };
  setTimeout(() => {
    run();
    setInterval(run, INTERVAL_MS).unref();
  }, FIRST_RUN_MS).unref();
}
