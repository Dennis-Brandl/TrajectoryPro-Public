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

import { expect, test, vi } from 'vitest';
import type { Pool } from 'pg';
import { createPgClient } from '../src/db/client.js';

// Audit 2026-10-20 DB-scale H6: an idle client that loses its connection emits 'error' on the
// pool. With no listener, EventEmitter throws it and the Commander process dies. No connection
// is opened here: pg connects lazily, on the first query.
test('a dropped idle connection is logged, not thrown, and connecting gives up after 5 s', async () => {
  const db = createPgClient('postgres://nobody@127.0.0.1:1/none');
  // drizzle keeps the pool it was given as $client (not in this drizzle version's types).
  const pool = (db as unknown as { $client: Pool }).$client;
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(() => pool.emit('error', new Error('terminating connection'))).not.toThrow();
  expect(log).toHaveBeenCalledWith(expect.stringContaining('terminating connection'));
  log.mockRestore();
  expect(pool.options.connectionTimeoutMillis).toBe(5000);
  await pool.end();
});
