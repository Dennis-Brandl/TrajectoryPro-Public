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
//
// Pins the app-distinct better-auth cookie prefix. Mission Designer (:3000), Mission Commander
// (:3005), and the Engine/Mission Pilot (:3006) all run better-auth on localhost, and
// cookies are stored per HOST, not per port — with the shared default prefix they
// clobbered each other's session token (2026-08-20: visiting the Pilot/CM made
// Designer's next save 401). Each app must keep a unique prefix.
import { expect, test } from 'vitest';
import { makeTestDb } from './helpers/db.js';
import { createAuth } from '../src/api/auth.js';

test("cookie prefix is 'mission-engine' — distinct from Designer and CM on the same host", async () => {
  const { db, close } = await makeTestDb();
  const auth = createAuth(db, { baseURL: 'http://127.0.0.1:3006', secret: 'test-secret' });
  expect(auth.options.advanced?.cookiePrefix).toBe('mission-engine');
  await close();
});
