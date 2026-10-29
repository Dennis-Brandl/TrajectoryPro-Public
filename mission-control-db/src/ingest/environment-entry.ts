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

import { and, eq, sql } from 'drizzle-orm';
import { environmentSpec, workflow, workflowEnvironment } from '../db/schema/index.js';
import { DaoError } from '../dao/errors.js';
import { isReloadableState } from '../constants.js';
import type { Schema } from '../db/client.js';
import type { PgDatabase } from 'drizzle-orm/pg-core';
type Db = PgDatabase<any, Schema>;

export type EnvUpsertMeta = { workCenterId: string; downloadedBy?: string; sourceFilename?: string };

// Insert-or-find an environment spec by its entry key (work center, oid, version, state).
// A same-key reload of a changed spec in an editable state replaces the row IN PLACE (the id
// never changes, so workflow links and the registry stay attached). Does NOT materialize.
export async function upsertEnvironmentSpec(
  tx: Db, es: any, meta: EnvUpsertMeta,
): Promise<{ id: string; downloadedAt: Date; status: 'loaded' | 'already_present' | 'replaced' }> {
  const version = es.version ?? '1.0.0';
  const state = es.state ?? 'Draft';
  const where = and(
    eq(environmentSpec.workCenterId, meta.workCenterId), eq(environmentSpec.oid, es.oid),
    eq(environmentSpec.version, version), eq(environmentSpec.state, state),
  );
  // jsonb = jsonb, so key order is irrelevant.
  const find = () => tx.select({
    id: environmentSpec.id, downloadedAt: environmentSpec.downloadedAt,
    same: sql<boolean>`${environmentSpec.specJsonb} = ${JSON.stringify(es)}::jsonb`,
  }).from(environmentSpec).where(where).limit(1);

  const [existing] = await find();
  if (existing) return resolveExisting(tx, existing, es, meta, state);

  // ON CONFLICT DO NOTHING never raises, so a lost race leaves the transaction healthy (a
  // caught statement error would abort it with 25P02) and yields an empty returning().
  const [row] = await tx.insert(environmentSpec).values({
    oid: es.oid, name: es.local_id, workCenterId: meta.workCenterId, version, state,
    sourceLibraryName: es.library_name ?? null, sourceLibraryOid: es.library_oid ?? null,
    schemaVersion: es.schemaVersion, specJsonb: es,
    sourceFilename: meta.sourceFilename, downloadedBy: meta.downloadedBy,
  }).onConflictDoNothing({
    target: [environmentSpec.workCenterId, environmentSpec.oid, environmentSpec.version, environmentSpec.state],
  }).returning({ id: environmentSpec.id, downloadedAt: environmentSpec.downloadedAt });
  if (row) return { id: row.id, downloadedAt: row.downloadedAt, status: 'loaded' };

  const [raced] = await find();
  if (!raced) throw new DaoError('INGEST_FAILED', `environment spec ${es.oid} vanished after insert/relookup`);
  return resolveExisting(tx, raced, es, meta, state);
}

async function resolveExisting(
  tx: Db, existing: { id: string; downloadedAt: Date; same: boolean }, es: any,
  meta: EnvUpsertMeta, state: string,
): Promise<{ id: string; downloadedAt: Date; status: 'already_present' | 'replaced' }> {
  if (existing.same || !isReloadableState(state)) {
    return { id: existing.id, downloadedAt: existing.downloadedAt, status: 'already_present' };
  }
  const now = new Date();
  const [row] = await tx.update(environmentSpec).set({
    specJsonb: es, name: es.local_id, schemaVersion: es.schemaVersion,
    sourceLibraryName: es.library_name ?? null, sourceLibraryOid: es.library_oid ?? null,
    sourceFilename: meta.sourceFilename ?? null, downloadedBy: meta.downloadedBy ?? null,
    downloadedAt: now, updatedAt: now,
  }).where(eq(environmentSpec.id, existing.id)).returning({ downloadedAt: environmentSpec.downloadedAt });
  return { id: existing.id, downloadedAt: row.downloadedAt, status: 'replaced' };
}

// The one traversal of a workflow spec's nesting: visits the root and every nested children[]
// spec (recursively, in walk order) that holds an environment_specifications array.
export function forEachSpecNode(spec: any, visit: (node: any) => void): void {
  if (!spec || typeof spec !== 'object') return;
  if (Array.isArray(spec.environment_specifications)) visit(spec);
  if (Array.isArray(spec.children)) for (const c of spec.children) forEachSpecNode(c, visit);
}

// Every environment spec object listed in environment_specifications on the root spec and on
// every nested children[] spec (recursively), in walk order.
export function nestedEnvironmentSpecs(spec: any): any[] {
  const out: any[] = [];
  forEachSpecNode(spec, (node) => out.push(...node.environment_specifications));
  return out;
}

// Replace every embedded copy of `es` (matched by oid) in the editable workflows linked to
// envSpecId. Released workflows are never touched. Returns the changed workflows' names, sorted.
export async function propagateEnvironmentToWorkflows(tx: Db, envSpecId: string, es: any): Promise<string[]> {
  const linked = await tx.select({ id: workflow.id, name: workflow.name, state: workflow.state, specJsonb: workflow.specJsonb })
    .from(workflowEnvironment)
    .innerJoin(workflow, eq(workflow.id, workflowEnvironment.workflowId))
    .where(eq(workflowEnvironment.environmentSpecId, envSpecId))
    // FOR UPDATE on the workflow rows: the whole spec is written back below, so a concurrent
    // workflow reload (which also locks the row) must not have its new spec overwritten.
    .for('update', { of: workflow });
  const changed: string[] = [];
  for (const wf of linked) {
    if (!isReloadableState(wf.state)) continue;
    const spec: any = wf.specJsonb;
    let touched = false;
    forEachSpecNode(spec, (node) => {
      node.environment_specifications = node.environment_specifications.map((e: any) => {
        if (e?.oid !== es.oid) return e;
        touched = true;
        return es;
      });
    });
    if (!touched) continue;
    await tx.update(workflow).set({ specJsonb: spec, updatedAt: new Date() }).where(eq(workflow.id, wf.id));
    changed.push(wf.name);
  }
  return changed.sort();
}
