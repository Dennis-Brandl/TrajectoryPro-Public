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

// Phase 35 §5.3: new API surface mounted at /api/v2/*. Reachable but unused
// by the client — Plan 3 wires the store to these endpoints.

import { Hono } from 'hono'
import { v2RequireOrigin, v2RequireSession } from '../../middleware/v2/permissions'
import { rateLimitV2 } from '../../middleware/v2/rateLimitV2'
import { librariesV2 } from './libraries'
import { specificationsV2 } from './specifications'
import { meV2 } from './me'
import { esignatureRolesV2 } from './esignatureRoles'
import { imagesV2 } from './images'
import { packagesV2 } from './packages'
import { adminV2 } from './admin'

export const v2Routes = new Hono()

// Health endpoint — no auth, no rate limit.
v2Routes.get('/health', (c) => c.json({ ok: true, phase: '2a' }))

// Everything else goes through origin + session + rate limit, in order.
// Handlers added in later waves register AFTER this line.
v2Routes.use('*', v2RequireOrigin)
v2Routes.use('*', v2RequireSession)
v2Routes.use('*', rateLimitV2)

v2Routes.route('/', librariesV2)
v2Routes.route('/', specificationsV2)
v2Routes.route('/', meV2)
v2Routes.route('/', esignatureRolesV2)
v2Routes.route('/', imagesV2)
v2Routes.route('/', packagesV2)
v2Routes.route('/', adminV2)

// Handler registrations are imported + mounted here by later tasks:
//   - Wave B: libraries, specifications (reads), me
//   - Wave C: images
//   - Wave D: specifications batch-save
//   - Wave E: libraries fork
