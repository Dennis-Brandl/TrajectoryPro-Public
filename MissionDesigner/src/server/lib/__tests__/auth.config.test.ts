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

// @vitest-environment node

// Pins the app-distinct better-auth cookie prefix. All three Mission Suite apps
// (Mission Designer :3000, Mission Commander :3005, Engine/Mission Pilot :3006) run better-auth on
// localhost, and cookies are stored per HOST, not per port — with the default
// "better-auth" prefix they clobber each other's session token, which surfaced
// 2026-08-20 as Designer's batch-save 401ing after a visit to the Pilot/CM
// ("It may have been deleted" toast). Each app must keep a unique prefix.
import { describe, it, expect } from 'vitest'
import { auth } from '../auth'

describe('better-auth cookie prefix', () => {
  it("is 'mission-designer' — distinct from the other Mission Suite apps on the same host", () => {
    expect(auth.options.advanced?.cookiePrefix).toBe('mission-designer')
  })
})
