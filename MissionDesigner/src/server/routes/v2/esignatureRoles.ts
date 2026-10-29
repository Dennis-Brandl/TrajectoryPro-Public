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

// Spec 2026-09-06 §4.2: the e-signature role list is administered under /admin/settings,
// but every author needs it in the form-designer inspector, so this read-only copy is
// served to any authenticated session (origin + session + rate limit run in ../index.ts).

import { Hono } from 'hono'
import { esignatureRoles } from '../../authz/policy'
import type { V2Session } from '../../middleware/v2/permissions'

type Variables = { v2Session: V2Session }

export const esignatureRolesV2 = new Hono<{ Variables: Variables }>()

esignatureRolesV2.get('/esignature-roles', async (c) => c.json({ roles: await esignatureRoles() }))
