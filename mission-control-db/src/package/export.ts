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

import AdmZip from 'adm-zip';
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  workCenter, workflow, environmentSpec, workflowEnvironment,
  role, workflowNode, workflowAllowedRole,
} from '../db/schema/index.js';
import { subtree } from '../dao/work-centers.js';
import { DaoError } from '../dao/errors.js';
import { buildNodePaths } from '../ingest/carry-over.js';
import {
  workCenterDir, assignFilenames,
  WFCENTER_FORMAT, WFCENTER_FORMAT_VERSION, WFCENTERX_EXTENSION, WFCENTER_MANIFEST_EXTENSION,
} from './wfcenter-format.js';
import type {
  PackageScope, WfcenterWorkCenter, WfcenterWorkflowEntry, WfcenterEnvironmentEntry,
  WfcenterRole, WfcenterGrant, WfcenterManifest, WfcenterRolesFile, WfcenterGrantsFile,
} from './wfcenter-format.js';
import type { Schema } from '../db/client.js';
import type { PgDatabase } from 'drizzle-orm/pg-core';

type Db = PgDatabase<any, Schema>;

const EFFECTIVE = 'Effective';

export type WorkflowRow = {
  id: string; oid: string; version: string; state: string; specJsonb: unknown; file: string;
};
export type EnvRow = WorkflowRow;

export type CollectedWorkCenter = {
  manifest: WfcenterWorkCenter;
  workflowRows: WorkflowRow[];
  environmentRows: EnvRow[];
};

/**
 * The work-center subtree plus every artifact it owns, shaped for the manifest.
 *
 * Returned parent-before-child (subtree() is already depth-ordered), which is the order the
 * importer relies on to create the tree without sorting.
 */
export async function collectWorkCenters(
  db: Db, rootId: string, scope: PackageScope,
): Promise<CollectedWorkCenter[]> {
  const nodes = await subtree(db, rootId);
  if (nodes.length === 0) return [];

  // node id → its escaped path, built top-down. subtree() guarantees a parent is visited
  // before its children, so the parent's path is always already known.
  const segmentsById = new Map<string, string[]>();
  const pathById = new Map<string, string>();
  for (const n of nodes) {
    const parentSegs = n.parentWorkCenterId ? segmentsById.get(n.parentWorkCenterId) : undefined;
    const segs = [...(parentSegs ?? []), n.name];
    segmentsById.set(n.id, segs);
    pathById.set(n.id, workCenterDir(segs));
  }

  const ids = nodes.map((n) => n.id);
  const rows = await db.select().from(workCenter).where(inArray(workCenter.id, ids));
  const configById = new Map(rows.map((r) => [r.id, r]));

  const out: CollectedWorkCenter[] = [];
  for (const n of nodes) {
    const cfg = configById.get(n.id)!;
    const path = pathById.get(n.id)!;
    const parentPath = n.id === rootId
      ? null
      : (n.parentWorkCenterId ? pathById.get(n.parentWorkCenterId) ?? null : null);

    const wfWhere = scope === 'effective'
      ? and(eq(workflow.workCenterId, n.id), eq(workflow.state, EFFECTIVE))
      : eq(workflow.workCenterId, n.id);
    const envWhere = scope === 'effective'
      ? and(eq(environmentSpec.workCenterId, n.id), eq(environmentSpec.state, EFFECTIVE))
      : eq(environmentSpec.workCenterId, n.id);

    // (name, version, state) is NOT unique — two different Designer specs can share a
    // local_id (spec §4.2) — so without an oid tiebreak Postgres is free to return tied
    // rows in any order and two exports of unchanged data could disagree.
    const wfs = await db.select().from(workflow).where(wfWhere)
      .orderBy(asc(workflow.name), asc(workflow.version), asc(workflow.state), asc(workflow.oid));
    const envs = await db.select().from(environmentSpec).where(envWhere)
      .orderBy(asc(environmentSpec.name), asc(environmentSpec.version), asc(environmentSpec.state), asc(environmentSpec.oid));

    const wfFiles = assignFilenames(wfs, '.WFmaster')
      .map((f) => `workflows/${path}/${f}`);
    const envFiles = assignFilenames(envs, '.WFenvir')
      .map((f) => `environments/${path}/${f}`);

    // env id → its natural key, so links can be expressed without uuids.
    const envKeyById = new Map(envs.map((e) => [e.id, { oid: e.oid, version: e.version, state: e.state }]));

    const links = wfs.length
      ? await db.select({
          workflowId: workflowEnvironment.workflowId,
          environmentSpecId: workflowEnvironment.environmentSpecId,
          source: workflowEnvironment.source,
        }).from(workflowEnvironment)
          .where(inArray(workflowEnvironment.workflowId, wfs.map((w) => w.id)))
      : [];

    const workflows: WfcenterWorkflowEntry[] = wfs.map((w, i) => ({
      file: wfFiles[i],
      oid: w.oid, name: w.name, version: w.version, state: w.state,
      dispatchPolicy: w.dispatchPolicy,
      autoClaim: w.autoClaim,
      effectiveFrom: w.effectiveFrom ? w.effectiveFrom.toISOString() : null,
      schemaVersion: w.schemaVersion,
      sourceFilename: w.sourceFilename,
      checksum: w.checksum,
      sourceLibraryName: w.sourceLibraryName,
      sourceLibraryOid: w.sourceLibraryOid,
      environments: links
        .filter((l) => l.workflowId === w.id)
        // A link to an environment excluded by scope has no natural key here and is dropped;
        // the importer would have nothing to resolve it against.
        .flatMap((l) => {
          const key = envKeyById.get(l.environmentSpecId);
          return key ? [{ ...key, source: l.source }] : [];
        }),
    }));

    const environments: WfcenterEnvironmentEntry[] = envs.map((e, i) => ({
      file: envFiles[i],
      oid: e.oid, name: e.name, version: e.version, state: e.state,
      effectiveFrom: e.effectiveFrom ? e.effectiveFrom.toISOString() : null,
      schemaVersion: e.schemaVersion,
      sourceFilename: e.sourceFilename,
      sourceLibraryName: e.sourceLibraryName,
      sourceLibraryOid: e.sourceLibraryOid,
    }));

    out.push({
      manifest: {
        path, parentPath,
        name: cfg.name, description: cfg.description, sortOrder: cfg.sortOrder,
        dispatchPolicy: cfg.dispatchPolicy,
        autoClaim: cfg.autoClaim,
        typeName: cfg.typeName,
        workflows, environments,
      },
      workflowRows: wfs.map((w, i) => ({
        id: w.id, oid: w.oid, version: w.version, state: w.state,
        specJsonb: w.specJsonb, file: wfFiles[i],
      })),
      environmentRows: envs.map((e, i) => ({
        id: e.id, oid: e.oid, version: e.version, state: e.state,
        specJsonb: e.specJsonb, file: envFiles[i],
      })),
    });
  }
  return out;
}

/**
 * Role definitions and per-node grants for everything in `collected`, as natural keys.
 *
 * Roles are REFERENCED-ONLY: only those some emitted grant actually uses.
 *
 * A grant whose node path is ambiguous (two nodes sharing a path identify neither) has no
 * portable expression, so it is warned about rather than guessed at or silently dropped.
 */
export async function collectRolesAndGrants(
  db: Db, collected: CollectedWorkCenter[],
): Promise<{ roles: WfcenterRole[]; grants: WfcenterGrant[]; warnings: string[] }> {
  const grants: WfcenterGrant[] = [];
  const warnings: string[] = [];
  const usedRoleIds = new Set<string>();

  for (const wc of collected) {
    for (const wf of wc.workflowRows) {
      const assignments = await db.select({
        nodeId: workflowAllowedRole.workflowNodeId, roleId: workflowAllowedRole.roleId,
      }).from(workflowAllowedRole).where(eq(workflowAllowedRole.workflowId, wf.id))
        .orderBy(asc(workflowAllowedRole.workflowNodeId), asc(workflowAllowedRole.roleId));
      if (assignments.length === 0) continue;

      const nodes = await db.select({
        id: workflowNode.id, parentNodeId: workflowNode.parentNodeId, name: workflowNode.name,
      }).from(workflowNode).where(eq(workflowNode.workflowId, wf.id));
      const paths = buildNodePaths(nodes);

      const roleIds = [...new Set(assignments.map((a) => a.roleId))];
      const roleRows = await db.select({ id: role.id, name: role.name })
        .from(role).where(inArray(role.id, roleIds));
      const roleNameById = new Map(roleRows.map((r) => [r.id, r.name]));

      const wfLabel = wc.manifest.workflows.find((m) => m.oid === wf.oid
        && m.version === wf.version && m.state === wf.state)?.name ?? wf.oid;

      for (const a of assignments) {
        const nodePath = paths.get(a.nodeId) ?? null;
        if (nodePath === null) {
          warnings.push(
            `Role grant on an ambiguous node in workflow "${wfLabel}" `
            + `(${wf.version}/${wf.state}) in "${wc.manifest.path}" was not exported: `
            + 'two or more nodes share the same path.',
          );
          continue;
        }
        const roleName = roleNameById.get(a.roleId);
        if (!roleName) continue; // role_id is a RESTRICT FK; unreachable, guarded anyway
        usedRoleIds.add(a.roleId);
        grants.push({
          workCenterPath: wc.manifest.path,
          workflow: { oid: wf.oid, version: wf.version, state: wf.state },
          nodePath, role: roleName,
        });
      }
    }
  }

  const roles: WfcenterRole[] = usedRoleIds.size
    ? (await db.select().from(role).where(inArray(role.id, [...usedRoleIds]))
        .orderBy(asc(role.name)))
        .map((r) => ({ name: r.name, description: r.description, isSystem: r.isSystem }))
    : [];

  return { roles, grants, warnings };
}

export type PackagePreview = {
  workCenters: number; workflows: number; environments: number;
  roles: number; grants: number; warnings: string[];
};

/**
 * What buildWfcenterx would produce, without producing it.
 *
 * Deliberately runs the SAME collectors rather than counting with its own queries: a preview
 * that drifts from the download is worse than no preview, and the warnings can only come
 * from the real path.
 */
export async function previewWfcenterx(
  db: Db, rootId: string, scope: PackageScope,
): Promise<PackagePreview> {
  const collected = await collectWorkCenters(db, rootId, scope);
  if (collected.length === 0) throw new DaoError('WORK_CENTER_NOT_FOUND');
  const { roles, grants, warnings } = await collectRolesAndGrants(db, collected);
  return {
    workCenters: collected.length,
    workflows: collected.reduce((n, c) => n + c.manifest.workflows.length, 0),
    environments: collected.reduce((n, c) => n + c.manifest.environments.length, 0),
    roles: roles.length,
    grants: grants.length,
    warnings,
  };
}

const json = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2), 'utf8');

/**
 * The whole package as a Buffer, plus the filename to serve it under and any warnings.
 *
 * `exportedAt` is injected rather than read from the clock so a test can assert the exact
 * manifest it expects.
 */
export async function buildWfcenterx(
  db: Db, rootId: string, opts: { scope: PackageScope; exportedAt: Date },
): Promise<{ buffer: Buffer; filename: string; warnings: string[] }> {
  const collected = await collectWorkCenters(db, rootId, opts.scope);
  if (collected.length === 0) throw new DaoError('WORK_CENTER_NOT_FOUND');

  const { roles, grants, warnings } = await collectRolesAndGrants(db, collected);

  // collectWorkCenters (via subtree()) orders by (depth, name): every node at a given depth
  // groups together regardless of which parent it belongs to, rather than each branch's
  // descendants following immediately after it. Re-sort by path for the manifest so the
  // array is both reproducible and reads as a tree. A lexicographic sort on the full path
  // still preserves parent-before-child: workCenterDir builds a child's path as the
  // parent's path + '/' + one more escaped segment, so a parent's path is ALWAYS a proper
  // prefix of every descendant's path, and a proper prefix always sorts first.
  const workCenters = [...collected]
    .sort((a, b) => (a.manifest.path < b.manifest.path ? -1 : a.manifest.path > b.manifest.path ? 1 : 0))
    .map((c) => c.manifest);

  const manifest: WfcenterManifest = {
    format: WFCENTER_FORMAT,
    formatVersion: WFCENTER_FORMAT_VERSION,
    exportedAt: opts.exportedAt.toISOString(),
    scope: opts.scope,
    warnings,
    workCenters,
  };

  const rootName = collected[0].manifest.path; // already escaped, and the root has no parent segment
  const zip = new AdmZip();
  zip.addFile(`${rootName}${WFCENTER_MANIFEST_EXTENSION}`, json(manifest));
  for (const wc of collected) {
    for (const w of wc.workflowRows) zip.addFile(w.file, json(w.specJsonb));
    for (const e of wc.environmentRows) zip.addFile(e.file, json(e.specJsonb));
  }
  zip.addFile('roles/roles.json', json({ roles } satisfies WfcenterRolesFile));
  zip.addFile('roles/allowed-roles.json', json({ grants } satisfies WfcenterGrantsFile));

  return { buffer: zip.toBuffer(), filename: `${rootName}${WFCENTERX_EXTENSION}`, warnings };
}
