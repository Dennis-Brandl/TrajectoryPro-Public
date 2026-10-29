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
import { eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { appUser } from 'mission-control-db/src/db/schema/index';
import { missionSystemCommanderWorkCenters } from 'mission-control-db/src/dao/work-centers';
import { requireSession, type Vars } from '../middleware/auth';

export const meRoutes = new Hono<{ Variables: Vars }>();

meRoutes.get('/me', requireSession, async (c) => {
  const principal = c.get('principal');
  const [row] = await db
    .select({ id: appUser.id, email: appUser.email, loginName: appUser.loginName, displayName: appUser.displayName })
    .from(appUser)
    .where(eq(appUser.id, principal.userId));
  return c.json({
    id: row.id,
    email: row.email,
    loginName: row.loginName,
    displayName: row.displayName,
    accessLevel: principal.accessLevel,
    isAdministrator: principal.accessLevel === 'administrator',
    rights: [...principal.rights].sort(),
    missionSystemCommanderOf: (await missionSystemCommanderWorkCenters(db, principal.userId)).sort(),
  });
});
