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
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import * as schema from 'mission-control-db/src/db/schema/index';
import { createPgClient, type Schema } from 'mission-control-db/src/db/client';

export type Db = PgDatabase<any, Schema>;

const useMemoryDb = process.env.NODE_ENV === 'test' || !!process.env.VITEST;

// In tests, a single in-memory PGlite instance is shared per worker; test/fixture.ts
// migrates and resets it. In dev/prod, mission-control-db owns the real pg Pool.
export const pglite = useMemoryDb ? new PGlite() : null;

export const db: Db = (
  useMemoryDb
    ? (drizzlePglite(pglite!, { schema }) as unknown as Db)
    : createPgClient(process.env.DATABASE_URL ?? 'postgres://localhost:5432/mission_control')
) as Db;

export { schema };
