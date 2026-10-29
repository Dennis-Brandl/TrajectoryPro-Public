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
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { makeTestDb } from '../../../test/helpers/db.js';

describe('system_settings schema (migration 0024)', () => {
  it('creates system_settings and the step_instance.action_invoked_oid column', async () => {
    const { db, close } = await makeTestDb();
    const cols = await db.execute(sql`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'system_settings'`);
    expect(cols.rows.map((r: any) => r.column_name).sort()).toEqual(['key', 'updated_at', 'value']);
    const step = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'step_instance' AND column_name = 'action_invoked_oid'`);
    expect(step.rows.length).toBe(1);
    await close();
  });
});
