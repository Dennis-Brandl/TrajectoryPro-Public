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

import { readZipEntries } from './zip.js';
import { upsertEnvironmentSpec, propagateEnvironmentToWorkflows } from './environment-entry.js';
import { isReloadableState } from '../constants.js';
import { DaoError } from '../dao/errors.js';
import { assertNameLength } from '../dao/names.js';
import { materializeEnvironmentRegistry } from '../dao/work-center-runtime.js';
import type { Schema } from '../db/client.js';
import type { PgDatabase } from 'drizzle-orm/pg-core';
type Db = PgDatabase<any, Schema>;

export async function ingestEnvironmentPackage(
  db: Db, buf: Buffer,
  meta: { workCenterId: string; downloadedBy?: string; sourceFilename?: string },
) {
  let root: any;
  let specs: any[];
  try {
    const entries = readZipEntries(buf);
    const inner = entries.find((e) => /\.WFenvir$/i.test(e.name) && e.json);
    if (!inner?.json) throw new DaoError('INVALID_PACKAGE', 'WFenvirX: no inner .WFenvir JSON found');
    root = inner.json;

    // Disambiguate overloaded extension by inner shape.
    specs = Array.isArray(root.environment_specifications)
      ? root.environment_specifications          // library shape
      : [root];                                  // single-env shape (has included_actions)
  } catch (err) {
    if (err instanceof DaoError) throw err;
    throw new DaoError('INVALID_PACKAGE', 'Not a valid WFenvirX package'); // adm-zip / JSON parse failure on a non-package upload
  }

  // Validated before the transaction opens, same reasoning as wfmasterx.ts: the load target is
  // resolved by workCenterId now, not by name, so nothing else on this path checks the name
  // against the btree index-row limit.
  for (const es of specs) assertNameLength(es.local_id);

  // Per-file atomicity: ingest all of a package's specs in ONE transaction, so a mid-loop
  // failure rolls the whole file back rather than leaving earlier specs committed. This keeps
  // the pull report's ok/failed verdict honest (matches the workflow ingest's transactional
  // shape) and shrinks the read->insert race window.
  return db.transaction(async (tx) => {
    const report: { id: string; name: string; version: string; state: string;
                    status: 'loaded' | 'already_present' | 'replaced'; message?: string }[] = [];
    const warnings: string[] = [];
    const updatedWorkflows = new Set<string>();
    for (const es of specs) {
      const version = es.version ?? '1.0.0';
      const state = es.state ?? 'Draft';
      const env = await upsertEnvironmentSpec(tx, es, meta);
      const entry: (typeof report)[number] = { id: env.id, name: es.local_id, version, state, status: env.status };
      if (env.status === 'already_present') {
        entry.message = isReloadableState(state)
          ? 'No changes since the last load.'
          : `Version ${version} ${state} is already loaded; raise the version to load changes.`;
      }
      report.push(entry);
      // Materialize on every status: the registry is derived state, so a re-load is the
      // operator's way to rebuild it. Idempotent, and never touches live values.
      const out = await materializeEnvironmentRegistry(tx, {
        workCenterId: meta.workCenterId, envSpecId: env.id, envSpecName: es.local_id,
        version, state, downloadedAt: env.downloadedAt, specJsonb: es,
      });
      warnings.push(...out.warnings);
      if (env.status === 'replaced') {
        for (const n of await propagateEnvironmentToWorkflows(tx, env.id, es)) updatedWorkflows.add(n);
      }
    }
    return { specs: report, warnings, updatedWorkflows: [...updatedWorkflows].sort() };
  });
}
