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
import { Hono } from 'hono';
import { inArray, eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { workCenter, workflow, environmentSpec } from 'mission-control-db/src/db/schema/index';
import { ingestWorkflowPackage } from 'mission-control-db/src/ingest/wfmasterx';
import { ingestEnvironmentPackage } from 'mission-control-db/src/ingest/wfenvirx';
import { actionServerWarnings } from 'mission-control-db/src/ingest/load-checks';
import { nestedEnvironmentSpecs } from 'mission-control-db/src/ingest/environment-entry';
import { DaoError } from 'mission-control-db/src/dao/errors';
import { requireSession, requirePermission, type Vars } from '../middleware/auth';
import { requireUuidParams, isUuid } from '../middleware/validate';
import { importBodyLimit } from '../middleware/upload-limit';
import { httpError, daoErrorStatus } from '../lib/errors';

// POST /api/work-centers/:id/load — the single entry point that replaced
// /workflows/import and /environments/import. One action may carry several packages of
// either kind and target several work centers, because that is how a steward actually
// rolls a release out to a line: same files, several cells.
// Load-time checks are warnings only: the ingest transaction has already committed by the time
// they run, so a failure here must never turn the pair into a failed result.
async function withChecks(base: string[], filename: string, workCenterId: string, run: () => Promise<string[]>): Promise<string[]> {
  try {
    return [...base, ...await run()];
  } catch (err) {
    console.error(`[load] checks ${filename} -> ${workCenterId}:`, err);
    return [...base, 'Load checks could not be run.'];
  }
}

export const loadRoutes = new Hono<{ Variables: Vars }>();
loadRoutes.use('/work-centers/:id/load', requireSession);

// Both create rights are required. That is not over-strict: principal rights are derived
// purely from the access tier (dao/access.ts TIER_RIGHTS), and every tier that holds one of
// these holds the other — so this can never deny a steward who could legitimately load only
// one kind. Checking per file would add a branch that no tier can currently exercise.
loadRoutes.post(
  '/work-centers/:id/load',
  requireUuidParams('id'),
  requirePermission('workflow:create'),
  requirePermission('environment:create'),
  importBodyLimit,
  async (c) => {
    const body = await c.req.parseBody({ all: true });

    const files = ([] as unknown[]).concat(body['file'] ?? []).filter((f): f is File => f instanceof File);
    if (files.length === 0) return httpError(c, 400, 'validation', 'at least one file is required');

    // Targets: the route's work center first, then any extras, de-duplicated so a steward
    // who also ticks the current work center does not load into it twice.
    const extras = ([] as unknown[]).concat(body['alsoWorkCenterId'] ?? []);
    for (const x of extras) {
      if (typeof x !== 'string' || !isUuid(x)) return httpError(c, 400, 'validation', 'alsoWorkCenterId must be a UUID');
    }
    const targets = [...new Set([c.req.param('id'), ...(extras as string[])])];

    // Existence check for EVERY target before any work begins (spec §7.1). A well-formed
    // uuid naming a deleted work center would otherwise trip ingest's NOT NULL FK and 500.
    // All-or-nothing deliberately: a partial fan-out gives the steward no way to tell which
    // half ran.
    const found = await db.select({ id: workCenter.id }).from(workCenter).where(inArray(workCenter.id, targets));
    if (found.length !== targets.length) {
      return httpError(c, 400, 'validation', 'one or more target work centers do not exist');
    }

    const userId = c.get('principal').userId;
    const results: Record<string, unknown>[] = [];

    // One (file × work center) pair at a time. Each ingest call owns its own transaction, so
    // a failure fails only its pair — the rest still commit (spec §6.2).
    for (const file of files) {
      const buf = Buffer.from(await file.arrayBuffer());
      const isEnv = /\.WFenvirX$/i.test(file.name);
      for (const workCenterId of targets) {
        try {
          if (isEnv) {
            const out = await ingestEnvironmentPackage(db, buf, {
              workCenterId, downloadedBy: userId, sourceFilename: file.name,
            });
            const statuses = out.specs.map((s) => s.status);
            const status = statuses.includes('replaced') ? 'replaced'
              : statuses.includes('loaded') ? 'loaded' : 'already_present';
            const msgs = [...new Set(out.specs.map((s) => s.message).filter((m): m is string => !!m))];
            const warnings = await withChecks(out.warnings, file.name, workCenterId, async () => {
              const envRows = out.specs.length
                ? await db.select({ specJsonb: environmentSpec.specJsonb }).from(environmentSpec)
                    .where(inArray(environmentSpec.id, out.specs.map((s) => s.id)))
                : [];
              return actionServerWarnings(db, workCenterId, envRows.map((r) => r.specJsonb));
            });
            results.push({
              filename: file.name, workCenterId, kind: 'environment',
              // Replaced beats loaded beats already_present: a package is only "already present"
              // when EVERY spec in it was.
              status,
              specs: out.specs,
              updatedWorkflows: out.updatedWorkflows,
              ...(status === 'already_present' && msgs.length ? { message: msgs.join(' ') } : {}),
              warnings,
            });
          } else {
            const out = await ingestWorkflowPackage(db, buf, {
              workCenterId, downloadedBy: userId, sourceFilename: file.name,
            });
            const warnings = await withChecks(out.warnings, file.name, workCenterId, async () => {
              const [wfRow] = await db.select({ specJsonb: workflow.specJsonb }).from(workflow)
                .where(eq(workflow.id, out.workflowId));
              return actionServerWarnings(db, workCenterId, nestedEnvironmentSpecs(wfRow?.specJsonb));
            });
            results.push({
              filename: file.name, workCenterId, kind: 'workflow', status: out.status,
              name: out.name, version: out.version, state: out.state,
              nodeCount: out.nodeCount, uiStepCount: out.uiStepCount, envCount: out.envCount,
              rolesCarried: out.carriedOver?.rolesCarried ?? 0,
              rolesCreated: out.rolesCreated,
              unmatchedPaths: out.carriedOver?.unmatchedPaths ?? [],
              nodesRemoved: out.nodesRemoved, nodesRetained: out.nodesRetained, grantsDropped: out.grantsDropped,
              ...(out.message ? { message: out.message } : {}),
              warnings,
            });
          }
        } catch (err) {
          // Per-pair isolation: report and continue. A 5xx-class DaoError is logged, since
          // it means an internal invariant broke rather than a bad package.
          const message = err instanceof DaoError ? (err.message || err.code) : 'Load failed';
          if (!(err instanceof DaoError) || daoErrorStatus(err.code) >= 500) {
            console.error(`[load] ${file.name} -> ${workCenterId}:`, err);
          }
          results.push({
            filename: file.name, workCenterId, kind: isEnv ? 'environment' : 'workflow',
            status: 'failed', message,
          });
        }
      }
    }
    return c.json({ results });
  },
);
