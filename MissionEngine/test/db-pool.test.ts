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
import { createDb } from '../src/db.js';

describe('createDb pool', () => {
  it('pool has a connection timeout and an error handler', async () => {
    const { pool } = createDb('postgres://u:p@127.0.0.1:1/x');
    expect(pool.options.connectionTimeoutMillis).toBe(5000);
    expect(pool.options.max).toBe(10);
    expect(pool.listenerCount('error')).toBeGreaterThanOrEqual(1);
    await pool.end();
  });
});
