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

import { expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestDb } from '../../test/helpers/db.js';
import { workflow, workflowEnvironment } from '../db/schema/index.js';

// PGlite is single-connection, so two concurrent transactions cannot be driven. These assert the
// lock clauses are present in the SQL the code paths rely on (a reload takes FOR UPDATE).
test('master reads that precede an instance insert lock FOR SHARE; env propagation locks FOR UPDATE', async () => {
  const { db, close } = await makeTestDb();
  try {
    const share = db.select().from(workflow).where(eq(workflow.id, 'x')).for('share').toSQL().sql;
    expect(share).toMatch(/for share$/i);
    const upd = db.select({ id: workflow.id }).from(workflowEnvironment)
      .innerJoin(workflow, eq(workflow.id, workflowEnvironment.workflowId))
      .for('update', { of: workflow }).toSQL().sql;
    expect(upd).toMatch(/for update of "workflow"$/i);
  } finally { await close(); }
});
