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
import { asc, eq } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { workflow } from '../db/schema/index.js';
import { startingParameterSpecs, type StartingParameterSpec } from '../runtime/instantiate.js';
import type { Schema } from '../db/client.js';
type Db = PgDatabase<any, Schema>;

/** One workflow of a work center as the Master Schedule editor's pickers need it. */
export type ScheduleWorkflowOption = {
  id: string; name: string; version: string; state: string;
  startingParameters: StartingParameterSpec[];
  /** Output parameter ids: what a chained item can read with "From triggering run". */
  outputs: string[];
};

function outputIds(spec: unknown): string[] {
  const list = (spec as { output_parameter_specifications?: unknown } | null)?.output_parameter_specifications;
  const ids: string[] = [];
  if (Array.isArray(list)) {
    for (const o of list) if (typeof (o as { id?: unknown })?.id === 'string') ids.push((o as { id: string }).id);
  }
  return ids;
}

export async function listScheduleWorkflowOptions(db: Db, workCenterId: string): Promise<ScheduleWorkflowOption[]> {
  const rows = await db.select({
    id: workflow.id, name: workflow.name, version: workflow.version, state: workflow.state, spec: workflow.specJsonb,
  }).from(workflow).where(eq(workflow.workCenterId, workCenterId)).orderBy(asc(workflow.name), asc(workflow.version));
  return rows.map((r) => ({
    id: r.id, name: r.name, version: r.version, state: r.state,
    startingParameters: startingParameterSpecs(r.spec), outputs: outputIds(r.spec),
  }));
}
