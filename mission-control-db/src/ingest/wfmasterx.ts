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

import { and, eq, notInArray, sql } from 'drizzle-orm';
import { readZipEntries } from './zip.js';
import {
  environmentSpec, workflow, workflowEnvironment, workflowNode, workflowUiStep,
} from '../db/schema/index.js';
import { DaoError } from '../dao/errors.js';
import { materializeEnvironmentRegistry } from '../dao/work-center-runtime.js';
import { carryOverConfig, type CarryOverReport } from './carry-over.js';
import { insertWorkflowEntry } from './insert-workflow-entry.js';
import { replaceWorkflowEntry } from './replace-workflow-entry.js';
import { upsertEnvironmentSpec, type EnvUpsertMeta } from './environment-entry.js';
import { isReloadableState } from '../constants.js';
import { resolveImageRows } from './images.js';
import { linkSignatureRoles } from './signature-roles.js';
import { workflowImage } from '../db/schema/workflows.js';
import type { Schema } from '../db/client.js';
import type { PgDatabase } from 'drizzle-orm/pg-core';

type Db = PgDatabase<any, Schema>;

export interface IngestMeta {
  /** The steward's target work center, resolved by the route. Required. */
  workCenterId: string;
  effectiveFrom?: Date;
  downloadedBy?: string;
  sourceFilename?: string;
}

const NO_CHANGES = 'No changes since the last load.';
const alreadyLoaded = (version: string, state: string) =>
  `Version ${version} ${state} is already loaded; raise the version to load changes.`;

export type IngestWorkflowResult = {
  status: 'loaded' | 'already_present' | 'replaced';
  workflowId: string; name: string; version: string; state: string;
  nodeCount: number; uiStepCount: number; envCount: number; imageCount: number;
  carriedOver: CarryOverReport | null; rolesCreated: string[]; warnings: string[];
  /** Node rows a reload deleted / kept for an unfinished runtime, and grants deleted with them. 0 unless replaced. */
  nodesRemoved: number; nodesRetained: number; grantsDropped: number;
  /** Set on already_present: why nothing changed. */
  message?: string;
};

export async function ingestWorkflowPackage(db: Db, buf: Buffer, meta: IngestMeta): Promise<IngestWorkflowResult> {
  let entries: ReturnType<typeof readZipEntries>;
  let root: any;
  try {
    entries = readZipEntries(buf);
    const rootEntry = entries.find((e) => /(^|\/)[^/]+\.WFmaster$/i.test(e.name) && !e.name.includes('/'));
    if (!rootEntry?.json) throw new DaoError('INVALID_PACKAGE', 'WFmasterX: no root .WFmaster JSON found');
    root = rootEntry.json;
  } catch (err) {
    if (err instanceof DaoError) throw err;
    throw new DaoError('INVALID_PACKAGE', 'Not a valid WFmasterX package'); // adm-zip / JSON parse failure on a non-package upload
  }

  // Image bytes ship as images/ ZIP entries while form_document srcs stay bare filenames
  // (Designer buildWorkflowPackage layout) — resolved here, stored per workflow entry below.
  const imageRows = resolveImageRows(root, entries);

  return db.transaction(async (tx) => {
    const version = root.version ?? '1.0.0';
    const state = root.state ?? 'Draft';
    const name = root.local_id;
    const entryMeta = {
      workCenterId: meta.workCenterId, version, state,
      effectiveFrom: meta.effectiveFrom,
      sourceLibraryName: root.library_name ?? null,
      sourceLibraryOid: root.library_oid ?? null,
      schemaVersion: root.schemaVersion,
      sourceFilename: meta.sourceFilename,
      downloadedBy: meta.downloadedBy,
    };
    const noRemovals = { nodesRemoved: 0, nodesRetained: 0, grantsDropped: 0 };

    // Spec 2026-10-18 §2.1: a same-key reload in an editable state replaces the copy in place.
    // Released states and fresh keys keep insertWorkflowEntry (shared with the .WFcenterX
    // importer, whose behaviour must not change). jsonb = jsonb, so key order is irrelevant.
    const [existing] = await tx.select({
      id: workflow.id, same: sql<boolean>`${workflow.specJsonb} = ${JSON.stringify(root)}::jsonb`,
    }).from(workflow).where(and(
      eq(workflow.workCenterId, meta.workCenterId), eq(workflow.oid, root.oid),
      eq(workflow.version, version), eq(workflow.state, state),
    )).limit(1);

    if (existing && isReloadableState(state)) {
      const replaced = existing.same ? null : await replaceWorkflowEntry(tx, existing.id, root, entryMeta);
      await storeImages(tx, existing.id, imageRows);
      // Signature roles the spec no longer references are never unlinked: a runtime on the
      // old copy may still need them (spec §2.1).
      const signatureRoles = await linkSignatureRoles(tx, existing.id, root);
      const warnings: string[] = [...signatureRoles.warnings];
      // The embedded environments run whether or not the workflow spec changed: an
      // environments/*.WFenvir library entry can change on its own. Only THIS workflow's
      // links are touched — no propagation into other workflows (spec §2.1).
      const envs = await linkEnvironments(tx, existing.id, collectEnvSpecs(root, entries), meta, warnings, upsertEnvironmentSpec);
      // Links follow the package: an environment it no longer embeds is unlinked. Download
      // links only — a 'manual' link is operator configuration, kept like grants.
      await tx.delete(workflowEnvironment).where(and(
        eq(workflowEnvironment.workflowId, existing.id),
        eq(workflowEnvironment.source, 'download'),
        envs.ids.length ? notInArray(workflowEnvironment.environmentSpecId, envs.ids) : undefined,
      ));
      const changed = replaced !== null || envs.anyReplaced;
      // An environment-only replace leaves the workflow's steps alone: report its current counts.
      const [nc] = replaced ? [] : await tx.select({ n: sql<number>`count(*)::int` }).from(workflowNode).where(eq(workflowNode.workflowId, existing.id));
      const [uc] = replaced ? [] : await tx.select({ n: sql<number>`count(*)::int` }).from(workflowUiStep).where(eq(workflowUiStep.workflowId, existing.id));
      return { status: changed ? 'replaced' as const : 'already_present' as const,
               workflowId: existing.id, name, version, state,
               nodeCount: replaced?.nodeCount ?? nc?.n ?? 0, uiStepCount: replaced?.uiStepCount ?? uc?.n ?? 0,
               envCount: envs.ids.length, imageCount: imageRows.length, carriedOver: null,
               rolesCreated: signatureRoles.created, warnings,
               nodesRemoved: replaced?.nodesRemoved ?? 0, nodesRetained: replaced?.nodesRetained ?? 0,
               grantsDropped: replaced?.grantsDropped ?? 0,
               ...(changed ? {} : { message: NO_CHANGES }) };
    }

    const entry = await insertWorkflowEntry(tx, root, entryMeta);

    // Last load wins, even on the already_present fast path: packages loaded before image
    // extraction existed (or re-exported with corrected images) backfill by re-loading —
    // the spec no-op rule stays intact while the display-only bytes refresh.
    await storeImages(tx, entry.workflowId, imageRows);

    // E-signature roles named by the package: find-or-create by name and link them to this
    // entry. Runs on the already_present path too, for the same reason images do — a package
    // loaded before this existed is backfilled by loading it again (the links are idempotent).
    const signatureRoles = await linkSignatureRoles(tx, entry.workflowId, root);

    if (entry.status === 'already_present') {
      return { status: 'already_present' as const, workflowId: entry.workflowId,
               name, version, state,
               nodeCount: 0, uiStepCount: 0, envCount: 0, imageCount: imageRows.length,
               carriedOver: null, rolesCreated: signatureRoles.created,
               warnings: signatureRoles.warnings, ...noRemovals,
               // An editable state reaches here only by losing an insert race to a concurrent
               // load of the same key.
               message: isReloadableState(state) ? NO_CHANGES : alreadyLoaded(version, state) };
    }

    const wf = { id: entry.workflowId };
    const nodeCount = entry.nodeCount, uiStepCount = entry.uiStepCount;

    // 3. extract embedded environments (inline env specs + environments/*.WFenvir libraries).
    // Same no-op rule, scoped to the work center: an environment already present is reused
    // and linked, never duplicated (spec §4.5) — and a fresh workflow load never rewrites it.
    const warnings: string[] = [...signatureRoles.warnings];
    const envs = await linkEnvironments(tx, wf.id, collectEnvSpecs(root, entries), meta, warnings, findOrInsertEnvironmentSpec);

    const carriedOver = await carryOverConfig(tx, {
      workCenterId: meta.workCenterId, oid: root.oid, newWorkflowId: wf.id,
    });

    return { status: 'loaded' as const, workflowId: wf.id, name, version, state,
             nodeCount, uiStepCount, envCount: envs.ids.length, imageCount: imageRows.length, carriedOver,
             rolesCreated: signatureRoles.created, warnings, ...noRemovals };
  });
}

async function storeImages(tx: Db, workflowId: string, imageRows: ReturnType<typeof resolveImageRows>): Promise<void> {
  for (const img of imageRows) {
    await tx.insert(workflowImage)
      .values({ workflowId, ...img })
      .onConflictDoUpdate({
        target: [workflowImage.workflowId, workflowImage.filename],
        set: { mimeType: img.mimeType, dataBase64: img.dataBase64 },
      });
  }
}

type EnvResolver = (tx: Db, es: any, meta: EnvUpsertMeta) =>
  Promise<{ id: string; downloadedAt: Date; status: 'loaded' | 'already_present' | 'replaced' }>;

// Resolve each embedded environment to its row, materialize its registry and link it to the
// workflow. Returns the rows this load used and whether any of them was replaced in place.
async function linkEnvironments(
  tx: Db, workflowId: string, envSpecs: any[], meta: IngestMeta, warnings: string[], resolve: EnvResolver,
): Promise<{ ids: string[]; anyReplaced: boolean }> {
  const ids: string[] = [];
  let anyReplaced = false;
  for (const es of envSpecs) {
    const envVersion = es.version ?? '1.0.0';
    const envState = es.state ?? 'Draft';
    const env = await resolve(tx, es, {
      workCenterId: meta.workCenterId, downloadedBy: meta.downloadedBy, sourceFilename: meta.sourceFilename,
    });
    if (env.status === 'replaced') anyReplaced = true;
    const materialized = await materializeEnvironmentRegistry(tx, {
      workCenterId: meta.workCenterId, envSpecId: env.id, envSpecName: es.local_id,
      version: envVersion, state: envState,
      downloadedAt: env.downloadedAt, specJsonb: es,
    });
    warnings.push(...materialized.warnings);
    await tx.insert(workflowEnvironment)
      .values({ workflowId, environmentSpecId: env.id, source: 'download' })
      .onConflictDoNothing();
    ids.push(env.id);
  }
  return { ids, anyReplaced };
}

// The fresh-load resolver (today's behaviour): find the row by its entry key or insert it;
// never rewrites an existing row.
async function findOrInsertEnvironmentSpec(tx: Db, es: any, meta: EnvUpsertMeta) {
  const envVersion = es.version ?? '1.0.0';
  const envState = es.state ?? 'Draft';
  const where = and(
    eq(environmentSpec.workCenterId, meta.workCenterId), eq(environmentSpec.oid, es.oid),
    eq(environmentSpec.version, envVersion), eq(environmentSpec.state, envState),
  );
  const cols = { id: environmentSpec.id, downloadedAt: environmentSpec.downloadedAt };
  const [found] = await tx.select(cols).from(environmentSpec).where(where).limit(1);
  if (found) return { ...found, status: 'already_present' as const };
  // ON CONFLICT DO NOTHING keeps the transaction healthy on a lost race (a caught statement
  // error would abort it with 25P02) and yields an empty returning() instead.
  const [inserted] = await tx.insert(environmentSpec).values({
    oid: es.oid, name: es.local_id, workCenterId: meta.workCenterId,
    version: envVersion, state: envState,
    sourceLibraryName: es.library_name ?? null, sourceLibraryOid: es.library_oid ?? null,
    schemaVersion: es.schemaVersion, specJsonb: es,
    sourceFilename: meta.sourceFilename, downloadedBy: meta.downloadedBy,
  }).onConflictDoNothing({
    target: [environmentSpec.workCenterId, environmentSpec.oid, environmentSpec.version, environmentSpec.state],
  }).returning(cols);
  if (inserted) return { ...inserted, status: 'loaded' as const };
  const [raced] = await tx.select(cols).from(environmentSpec).where(where).limit(1);
  if (!raced) throw new DaoError('INGEST_FAILED', `environment spec ${es.oid} vanished after insert/relookup`);
  return { ...raced, status: 'already_present' as const };
}

// Env specs come from the workflow's inline environment_specifications[] and/or environments/*.WFenvir libraries.
function collectEnvSpecs(root: any, entries: ReturnType<typeof readZipEntries>): any[] {
  const byOid = new Map<string, any>();
  for (const es of root.environment_specifications ?? []) if (es?.oid) byOid.set(es.oid, es);
  for (const e of entries) {
    if (!/environments\/.+\.WFenvir$/i.test(e.name) || !e.json) continue;
    const lib = e.json as any;
    for (const es of lib.environment_specifications ?? []) if (es?.oid) byOid.set(es.oid, es);
  }
  return [...byOid.values()];
}
