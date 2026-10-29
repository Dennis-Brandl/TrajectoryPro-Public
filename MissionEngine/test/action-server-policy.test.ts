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
// Spec 2026-09-05: the engine's ActionClient reads its allowlist and trust mode live from
// system_settings (Task 1's DAO) rather than a static boot-time list, and the
// ACTION_SERVER_ALLOWLIST env only seeds that row once on first boot. This exercises the
// DB-backed policy source end to end against a real (PGlite) schema.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { makeTestDb } from './helpers/db.js';
import { seedActionServerAllowlistIfAbsent, getActionServerPolicy, setActionServerTrust } from 'mission-control-db/src/dao/system-settings';
import { ActionClient } from '../src/actions/client.js';

afterEach(() => { vi.restoreAllMocks(); });

describe('engine action-server policy from the shared DB (spec 2026-09-05)', () => {
  it('seeds ACTION_SERVER_ALLOWLIST once, then the DB wins', async () => {
    const { db, close } = await makeTestDb();
    expect(await seedActionServerAllowlistIfAbsent(db, ['http://mission-autopilot-server:3002'])).toBe(true);
    expect(await seedActionServerAllowlistIfAbsent(db, ['http://changed-env:1'])).toBe(false);
    const client = new ActionClient(() => getActionServerPolicy(db), vi.fn());
    expect(await client.isAllowed('http://mission-autopilot-server:3002')).toBe(true);
    expect(await client.isAllowed('http://changed-env:1')).toBe(false);
    await setActionServerTrust(db, 'loose');
    expect(await client.isAllowed('http://changed-env:1')).toBe(true);
    await close();
  });
});
