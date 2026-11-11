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

import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema/index.js';

// Audit 2026-10-20 DB-scale H6 (same settings as the engine): a connection attempt gives up
// after 5 s instead of hanging a request, and an idle client that loses its connection (a
// database restart) is logged instead of crashing the process; the pool replaces it.
export function createPgClient(url: string): NodePgDatabase<typeof schema> {
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 5000 });
  pool.on('error', (err) => { console.error(`[mission-control-db] idle database client error: ${err.message}`); });
  return drizzlePg(pool, { schema });
}
export type Schema = typeof schema;
