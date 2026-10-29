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

// Phase 4a (design §12): admin-only management surface under /api/v2/admin/*.
// The v2 pipeline (origin → session → rate-limit) already ran; this router
// adds the D14 admin gate on top. Non-admins get 403 forbidden (D15 — the
// existence of the admin surface is not sensitive).

import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { v2ErrorBody } from '../../../errors/v2'
import type { V2Session } from '../../../middleware/v2/permissions'
import { adminTeamsV2 } from './teams'
import { adminMembersV2 } from './members'
import { adminRolesV2 } from './roles'
import { adminSettingsV2 } from './settings'
import { adminUsersV2 } from './users'
import { adminSetupV2 } from './setup'
import { adminLibrariesV2 } from './libraries'

type Variables = { v2Session: V2Session }

export const requireV2Admin: MiddlewareHandler<{ Variables: Variables }> = async (c, next) => {
  const session = c.get('v2Session')
  if (!session.isAdministrator) {
    return c.json(v2ErrorBody('forbidden'), 403)
  }
  await next()
}

export const adminV2 = new Hono<{ Variables: Variables }>()
// Blanket gate — every route any admin sub-router registers is admin-only,
// regardless of its path. Path-prefix matching would silently skip routes
// registered outside /admin/*.
adminV2.use('*', requireV2Admin)
adminV2.route('/', adminTeamsV2)
adminV2.route('/', adminMembersV2)
adminV2.route('/', adminRolesV2)
adminV2.route('/', adminSettingsV2)
adminV2.route('/', adminUsersV2)
adminV2.route('/', adminSetupV2)
adminV2.route('/', adminLibrariesV2)
