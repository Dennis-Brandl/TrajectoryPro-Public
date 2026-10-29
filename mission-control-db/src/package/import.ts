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

import { and, eq, inArray } from 'drizzle-orm';
import { readZipEntries } from '../ingest/zip.js';
import { DaoError } from '../dao/errors.js';
import { lenientTypeName } from '../dao/type-name.js';
import {
  workCenter, workflow, environmentSpec, workflowEnvironment, role, workflowNode, workflowAllowedRole,
} from '../db/schema/index.js';
import { createWorkCenter } from '../dao/work-centers.js';
import { materializeEnvironmentRegistry } from '../dao/work-center-runtime.js';
import { insertWorkflowEntry } from '../ingest/insert-workflow-entry.js';
import { buildNodePaths } from '../ingest/carry-over.js';
import {
  WFCENTER_FORMAT, WFCENTER_FORMAT_VERSION, WFCENTER_MANIFEST_EXTENSION,
} from './wfcenter-format.js';
import type {
  WfcenterManifest, WfcenterRole, WfcenterGrant, WfcenterRolesFile, WfcenterGrantsFile,
  WfcenterWorkCenter,
} from './wfcenter-format.js';
import type { Schema } from '../db/client.js';
import type { PgDatabase } from 'drizzle-orm/pg-core';

type Db = PgDatabase<any, Schema>;

export type ReadPackage = {
  manifest: WfcenterManifest;
  roles: WfcenterRole[];
  grants: WfcenterGrant[];
  /** manifest `file` path → parsed spec JSON. Never keyed by a parsed filename (spec §4.2). */
  specByFile: Map<string, unknown>;
};

const bad = (msg: string) => new DaoError('INVALID_PACKAGE', msg);

/**
 * Parse and fully validate a .WFcenterX before any write happens.
 *
 * Everything that can be checked from the archive alone is checked HERE rather than during
 * the import transaction: discovering a dangling `file` reference mid-insert would abort a
 * partially-applied transaction, and the operator would see a failure whose cause is a
 * corrupt package rather than anything about their database.
 */
export function readWfcenterx(buf: Buffer): ReadPackage {
  let entries: ReturnType<typeof readZipEntries>;
  try {
    entries = readZipEntries(buf);
  } catch (err) {
    if (err instanceof DaoError) throw err;   // preserve the zip-bomb caps' own messages
    throw bad('Not a valid WFcenterX package');
  }

  // Two root manifests are ambiguous, and picking one by position would make the imported
  // subtree a property of the zip's central-directory order. Merge mode (P3) previews a
  // resolution in a rolled-back transaction and replays it on confirm; both passes must read
  // the same manifest, so ambiguity is refused here rather than resolved arbitrarily.
  const rootEntries = entries.filter(
    (e) => !e.name.includes('/') && e.name.toLowerCase().endsWith(WFCENTER_MANIFEST_EXTENSION.toLowerCase()),
  );
  if (rootEntries.length > 1) {
    throw bad(
      `WFcenterX: ${rootEntries.length} root .WFcenter manifests found `
      + `(${rootEntries.map((e) => e.name).join(', ')}); a package must contain exactly one`,
    );
  }
  const rootEntry = rootEntries[0];
  if (!rootEntry?.json) throw bad('WFcenterX: no root .WFcenter manifest found');

  const manifest = rootEntry.json as WfcenterManifest;
  if (manifest.format !== WFCENTER_FORMAT) {
    throw bad(`WFcenterX: unexpected format "${String(manifest.format)}"`);
  }
  if (manifest.formatVersion !== WFCENTER_FORMAT_VERSION) {
    throw bad(`WFcenterX: unsupported formatVersion "${String(manifest.formatVersion)}"`);
  }
  if (!Array.isArray(manifest.workCenters)) throw bad('WFcenterX: manifest has no workCenters array');

  // §8.6.4 threads this straight into ImportReport.warnings, which the renderer
  // (ImportPackageDialog's ImportReportSummary) calls `.map()` on with no further check and no
  // ErrorBoundary anywhere in this app to catch a thrown TypeError — a present-but-wrong shape
  // must be rejected here, the same as workCenters above and roles/grants below.
  if (!Array.isArray(manifest.warnings)) throw bad('WFcenterX: manifest has no warnings array');

  for (const wc of manifest.workCenters) {
    if (wc.typeName !== undefined && wc.typeName !== null && typeof wc.typeName !== 'string') {
      throw bad(`WFcenterX: work center "${wc.path}" has a non-string typeName`);
    }
  }

  // Every work-center path must be unique. Task 4 keys a path→id map with
  // `idByPath.set(wc.path, created.id)` — last-write-wins — so a duplicate path would let a
  // later descendant's parentPath silently attach to whichever entry wrote last, with no DB
  // constraint necessarily catching it (the two entries need not collide on name+parent).
  const paths = new Set<string>();
  for (const wc of manifest.workCenters) {
    if (paths.has(wc.path)) throw bad(`WFcenterX: duplicate work center path "${wc.path}"`);
    paths.add(wc.path);
  }

  // Every non-null parentPath must resolve to some entry's path. Task 4's planned resolution
  // is `idByPath.get(wc.parentPath) ?? null`, which folds an unresolvable parentPath into the
  // SAME branch as a legitimate root — silently building the wrong tree rather than failing.
  for (const wc of manifest.workCenters) {
    if (wc.parentPath !== null && !paths.has(wc.parentPath)) {
      throw bad(`WFcenterX: work center "${wc.path}" has an unresolvable parentPath "${wc.parentPath}"`);
    }
  }

  // Existing (not merely present) is not enough: Task 4 builds the tree in a single forward
  // pass, populating idByPath only with entries already processed, so a parentPath that
  // resolves somewhere but not at a STRICTLY EARLIER index falls through the same
  // `?? null` into a silent root. Spec §5 promises parent-before-child ordering and the
  // exporter guarantees it, but this reader validates an archive that may come from anywhere.
  // This single check subsumes a forward reference (child before parent) and a cycle (no
  // cycle member can precede all the others) — the dangling check above stays separate only
  // so its error message names the real cause instead of a generic ordering failure.
  const seenPaths = new Set<string>();
  for (const wc of manifest.workCenters) {
    if (wc.parentPath !== null && !seenPaths.has(wc.parentPath)) {
      throw bad(
        `WFcenterX: work center "${wc.path}" has parentPath "${wc.parentPath}", `
        + 'which must appear earlier in workCenters[] (out of order, or part of a cycle)',
      );
    }
    seenPaths.add(wc.path);
  }

  const byName = new Map(entries.map((e) => [e.name, e]));
  const specByFile = new Map<string, unknown>();
  for (const wc of manifest.workCenters) {
    for (const entry of [...(wc.workflows ?? []), ...(wc.environments ?? [])]) {
      const found = byName.get(entry.file);
      if (!found?.json) throw bad(`WFcenterX: manifest references a missing or unreadable entry "${entry.file}"`);
      specByFile.set(entry.file, found.json);
    }
  }

  // Both role files are optional: a package whose grants were all warned-and-omitted, or one
  // with no roles at all, is valid and simply carries none. But a file that IS present and
  // fails to parse, or parses without the expected array, is a corrupt package — not the same
  // as "no roles file". readZipEntries swallows JSON parse errors (ingest/zip.ts), so a
  // corrupt file reaches us as an entry that exists with `json === undefined`, which must be
  // told apart from "no such entry". workflow_allowed_role is an allowlist-style per-node
  // restriction, so silently treating corrupt-as-absent would make the imported subtree MORE
  // PERMISSIVE than the source, with no warning.
  const rolesEntry = byName.get('roles/roles.json');
  let roles: WfcenterRole[] = [];
  if (rolesEntry) {
    if (rolesEntry.json === undefined) throw bad('WFcenterX: roles/roles.json is present but unreadable');
    const rolesFile = rolesEntry.json as WfcenterRolesFile;
    if (!Array.isArray(rolesFile.roles)) throw bad('WFcenterX: roles/roles.json is missing its roles array');
    roles = rolesFile.roles;
  }

  const grantsEntry = byName.get('roles/allowed-roles.json');
  let grants: WfcenterGrant[] = [];
  if (grantsEntry) {
    if (grantsEntry.json === undefined) throw bad('WFcenterX: roles/allowed-roles.json is present but unreadable');
    const grantsFile = grantsEntry.json as WfcenterGrantsFile;
    if (!Array.isArray(grantsFile.grants)) throw bad('WFcenterX: roles/allowed-roles.json is missing its grants array');
    grants = grantsFile.grants;
  }

  return {
    manifest,
    roles,
    grants,
    specByFile,
  };
}

/** One D10 overwrite, recorded at the moment the difference is detected (spec §8.6). */
export type ConfigChange = {
  workCenterPath: string;
  /** null for a work-center-level field; set for a per-entry override. */
  workflow: { oid: string; version: string; state: string } | null;
  field: string;
  from: string | number | boolean | null;
  to: string | number | boolean | null;
};

/** A grant on the target that the package does not declare (spec §8.5.1). */
export type TargetOnlyGrant = {
  workCenterPath: string;
  workflow: { oid: string; version: string; state: string };
  nodePath: string;
  role: string;
};

export type ImportReport = {
  rootWorkCenterId: string;
  workCenters: { matched: number; created: number };
  workflows: { created: number; alreadyPresent: number };
  environments: { created: number; alreadyPresent: number };
  links: { created: number; alreadyPresent: number };
  roles: { created: number };
  grants: { created: number; alreadyPresent: number; unresolved: string[] };
  configChanges: ConfigChange[];
  targetOnlyGrants: TargetOnlyGrant[];
  warnings: string[];
};

export type ImportOptions =
  | { mode: 'create'; parentWorkCenterId: string | null; downloadedBy?: string | null }
  | { mode: 'merge'; targetWorkCenterId: string; confirmed: boolean; downloadedBy?: string | null };

/**
 * Carries a finished preview report out of the transaction by THROWING.
 *
 * ⚠️ The throw IS the rollback mechanism (spec §8.6.1). Drizzle rolls a transaction back when
 * its callback throws and commits when it returns, so a preview cannot `return` — that would
 * apply the merge it was only supposed to describe. Do not "fix" this into a return: no test
 * fails on a wrong report, only the ones asserting the database is unchanged afterwards.
 */
class PreviewComplete extends Error {
  constructor(public readonly report: ImportReport) {
    super('WFcenterX merge preview complete');
    this.name = 'PreviewComplete';
  }
}

/**
 * D10 (§8.5.2): on a MATCHED work center the package's config scalars win.
 *
 * `name` is excluded deliberately — it is the merge identity, and rewriting it would change
 * what the next merge matches. Provenance has no work-center equivalent, so the whole set is
 * the three columns below. Only fields whose value actually differs are written or recorded,
 * which is what keeps `configChanges` a list of real overwrites rather than of no-op writes.
 */
async function applyWorkCenterConfig(
  tx: Db, id: string, wc: WfcenterWorkCenter, report: ImportReport,
): Promise<void> {
  const [current] = await tx.select({
    description: workCenter.description,
    sortOrder: workCenter.sortOrder,
    dispatchPolicy: workCenter.dispatchPolicy,
    autoClaim: workCenter.autoClaim,
    typeName: workCenter.typeName,
  }).from(workCenter).where(eq(workCenter.id, id)).limit(1);
  if (!current) throw new DaoError('WORK_CENTER_NOT_FOUND', `work center ${id} vanished during merge`);

  const desired = {
    description: wc.description,
    sortOrder: wc.sortOrder,
    dispatchPolicy: wc.dispatchPolicy,
    autoClaim: wc.autoClaim,
    typeName: wc.typeName === undefined ? undefined : lenientTypeName(wc.typeName),
  };
  const patch: Partial<typeof desired> = {};
  for (const field of ['description', 'sortOrder', 'dispatchPolicy', 'autoClaim', 'typeName'] as const) {
    // An ABSENT autoClaim or typeName key means the package predates the feature, not that its author
    // chose false — overwriting hand-set config from silence is the §8.5.1 "never
    // auto-removed" rule's territory (review fix). The other three fields are always
    // present in every package version. (typeName null, by contrast, is an explicit clear.)
    const to = desired[field];
    if (to === undefined) continue; // autoClaim and typeName can be absent (pre-feature package)
    if (current[field] === to) continue;
    (patch as any)[field] = to;
    report.configChanges.push({
      workCenterPath: wc.path, workflow: null, field,
      from: current[field], to,
    });
  }
  if (Object.keys(patch).length === 0) return;
  await tx.update(workCenter).set({ ...patch, updatedAt: new Date() }).where(eq(workCenter.id, id));
}

/**
 * Replay a .WFcenterX into this instance as a NEW work-center subtree.
 *
 * ONE transaction (spec §8.3): work_center.parent_work_center_id is RESTRICT, so a partial
 * failure would leave a fragment that cannot be deleted without manual teardown.
 */
export async function importWfcenterx(
  db: Db, buf: Buffer, opts: ImportOptions,
): Promise<ImportReport> {
  const pkg = readWfcenterx(buf);   // validated fully BEFORE the transaction opens

  try {
    return await db.transaction(async (tx) => {
    const report: ImportReport = {
      rootWorkCenterId: '',
      workCenters: { matched: 0, created: 0 },
      workflows: { created: 0, alreadyPresent: 0 },
      environments: { created: 0, alreadyPresent: 0 },
      links: { created: 0, alreadyPresent: 0 },
      roles: { created: 0 },
      grants: { created: 0, alreadyPresent: 0, unresolved: [] },
      configChanges: [],
      targetOnlyGrants: [],
      // §8.6.4 — what the EXPORT dropped (e.g. an ambiguous node path), surfaced where the
      // steward decides rather than left buried in an archive they will not open. Copied, not
      // aliased: the target-only-grants step below pushes onto this same array, and that must
      // never mutate pkg.manifest.warnings, the parsed package's own object.
      warnings: [...(pkg.manifest.warnings ?? [])],
    };

    // 1. Work centers, parent before child (manifest order, §5).
    //
    // Create mode inserts every entry. Merge mode instead RESOLVES each entry against the
    // target subtree: the package root is the caller's target, and each descendant is looked
    // up by exact name under its already-resolved parent. A hit is `matched` and takes the D10
    // config overwrite; a miss falls through to the same createWorkCenter call create mode
    // uses. readWfcenterx guarantees parent-before-child, so the parent id is always known —
    // the identical property create mode already depends on.
    const idByPath = new Map<string, string>();
    for (const wc of pkg.manifest.workCenters) {
      let parentId: string | null;
      if (wc.parentPath === null) {
        parentId = opts.mode === 'create' ? opts.parentWorkCenterId : null;
      } else {
        const resolved = idByPath.get(wc.parentPath);
        if (resolved === undefined) {
          throw new DaoError(
            'INGEST_FAILED',
            `WFcenterX: work center "${wc.path}" has an unresolved parentPath "${wc.parentPath}"`,
          );
        }
        parentId = resolved;
      }

      let existingId: string | null = null;
      if (opts.mode === 'merge') {
        if (wc.parentPath === null) {
          existingId = opts.targetWorkCenterId;
        } else {
          // Name uniqueness is level-scoped (work_center_child_name_uq), so the match is made
          // against this parent only — never globally (§8.4).
          const [hit] = await tx.select({ id: workCenter.id }).from(workCenter).where(and(
            eq(workCenter.parentWorkCenterId, parentId!), eq(workCenter.name, wc.name),
          )).limit(1);
          existingId = hit?.id ?? null;
        }
      }

      if (existingId !== null) {
        await applyWorkCenterConfig(tx, existingId, wc, report);
        idByPath.set(wc.path, existingId);
        report.workCenters.matched++;
      } else {
        const created = await createWorkCenter(tx, {
          name: wc.name,
          parentWorkCenterId: parentId,
          description: wc.description,
          sortOrder: wc.sortOrder,
          dispatchPolicy: wc.dispatchPolicy,
          autoClaim: wc.autoClaim ?? false,
          typeName: lenientTypeName(wc.typeName),
        });
        idByPath.set(wc.path, created.id);
        report.workCenters.created++;
      }
    }
    report.rootWorkCenterId = idByPath.get(pkg.manifest.workCenters[0]?.path ?? '') ?? '';

    // 2. Environments BEFORE workflows, so step 4's links resolve.
    //    Keyed by (work-center path, oid, version, state) — the package's natural key.
    const envIdByKey = new Map<string, string>();
    // JSON.stringify of the tuple rather than joining on a separator: oid, version and
    // state are arbitrary author-supplied text, so ANY chosen delimiter could appear
    // inside a value and collide two different keys. JSON escaping is injective.
    const envKey = (path: string, oid: string, version: string, state: string) =>
      JSON.stringify([path, oid, version, state]);

    for (const wc of pkg.manifest.workCenters) {
      const workCenterId = idByPath.get(wc.path)!;
      for (const e of wc.environments ?? []) {
        const [existing] = await tx.select({
          id: environmentSpec.id, downloadedAt: environmentSpec.downloadedAt,
        }).from(environmentSpec).where(and(
          eq(environmentSpec.workCenterId, workCenterId), eq(environmentSpec.oid, e.oid),
          eq(environmentSpec.version, e.version), eq(environmentSpec.state, e.state),
        )).limit(1);
        if (existing) {
          envIdByKey.set(envKey(wc.path, e.oid, e.version, e.state), existing.id);
          report.environments.alreadyPresent++;
          const m = await materializeEnvironmentRegistry(tx, {
            workCenterId, envSpecId: existing.id, envSpecName: e.name,
            version: e.version, state: e.state, downloadedAt: existing.downloadedAt,
            specJsonb: pkg.specByFile.get(e.file),
          });
          report.warnings.push(...m.warnings);
          continue;
        }
        const [row] = await tx.insert(environmentSpec).values({
          oid: e.oid, name: e.name, workCenterId,
          version: e.version, state: e.state,
          effectiveFrom: e.effectiveFrom ? new Date(e.effectiveFrom) : null,
          schemaVersion: e.schemaVersion,
          specJsonb: pkg.specByFile.get(e.file),
          sourceFilename: e.sourceFilename,
          sourceLibraryName: e.sourceLibraryName,
          sourceLibraryOid: e.sourceLibraryOid,
          downloadedBy: opts.downloadedBy ?? null,
        }).returning({ id: environmentSpec.id, downloadedAt: environmentSpec.downloadedAt });
        envIdByKey.set(envKey(wc.path, e.oid, e.version, e.state), row!.id);
        report.environments.created++;
        const m = await materializeEnvironmentRegistry(tx, {
          workCenterId, envSpecId: row!.id, envSpecName: e.name,
          version: e.version, state: e.state, downloadedAt: row!.downloadedAt,
          specJsonb: pkg.specByFile.get(e.file),
        });
        report.warnings.push(...m.warnings);
      }
    }

    // 3. Workflows and their node trees. No carry-over — insertWorkflowEntry does not call it.
    // key: work-center path + oid + version + state → the new workflow id
    const wfIdByKey = new Map<string, string>();
    // Entries that were already on the target before this import. Used by §8.6.4: only these
    // can have grants the package does not declare.
    const preExistingWorkflowIds = new Set<string>();
    for (const wc of pkg.manifest.workCenters) {
      const workCenterId = idByPath.get(wc.path)!;
      for (const w of wc.workflows ?? []) {
        const entry = await insertWorkflowEntry(tx, pkg.specByFile.get(w.file), {
          workCenterId, version: w.version, state: w.state,
          effectiveFrom: w.effectiveFrom ? new Date(w.effectiveFrom) : null,
          dispatchPolicy: w.dispatchPolicy,
          autoClaim: w.autoClaim ?? null,
          schemaVersion: w.schemaVersion,
          sourceFilename: w.sourceFilename,
          checksum: w.checksum,
          sourceLibraryName: w.sourceLibraryName,
          sourceLibraryOid: w.sourceLibraryOid,
          downloadedBy: opts.downloadedBy ?? null,
        });
        if (entry.status === 'inserted') report.workflows.created++;
        else {
          report.workflows.alreadyPresent++;
          preExistingWorkflowIds.add(entry.workflowId);
          // D10 for the per-entry override (§8.5.2). Deliberately NOT folded into
          // insertWorkflowEntry: that function is shared with ingest/wfmasterx.ts, and teaching
          // it to update on collision would make re-loading a .WFmasterX overwrite a hand-set
          // override — the no-op M6 promises. One named column, so provenance cannot ride along.
          if (opts.mode === 'merge') {
            const [current] = await tx.select({ dispatchPolicy: workflow.dispatchPolicy, autoClaim: workflow.autoClaim })
              .from(workflow).where(eq(workflow.id, entry.workflowId)).limit(1);
            if (current) {
              // Per-entry D10 overrides, accumulated into ONE update (same shape as
              // applyWorkCenterConfig above). dispatchPolicy has always been in the format,
              // so absent means null; autoClaim ABSENT means the package predates the
              // feature and expresses no opinion — never reset a hand-set override from
              // silence (review fix) — while a PRESENT null is a real "inherit".
              const desired: { dispatchPolicy: string | null; autoClaim?: boolean | null } = {
                dispatchPolicy: w.dispatchPolicy ?? null,
                ...(w.autoClaim !== undefined ? { autoClaim: w.autoClaim } : {}),
              };
              const entryPatch: { dispatchPolicy?: string | null; autoClaim?: boolean | null } = {};
              for (const field of ['dispatchPolicy', 'autoClaim'] as const) {
                if (!(field in desired)) continue;
                const to = desired[field] as string | boolean | null;
                if (current[field] === to) continue;
                (entryPatch as Record<string, unknown>)[field] = to;
                report.configChanges.push({
                  workCenterPath: wc.path,
                  workflow: { oid: w.oid, version: w.version, state: w.state },
                  field,
                  from: current[field], to,
                });
              }
              if (Object.keys(entryPatch).length > 0) {
                await tx.update(workflow).set(entryPatch).where(eq(workflow.id, entry.workflowId));
              }
            }
          }
        }
        wfIdByKey.set(envKey(wc.path, w.oid, w.version, w.state), entry.workflowId);

        // 4. Links, from the manifest — never re-derived from the spec's inline environments,
        //    which would produce a different link set than the source had (spec §8.2).
        for (const ref of w.environments ?? []) {
          const envId = envIdByKey.get(envKey(wc.path, ref.oid, ref.version, ref.state));
          if (!envId) continue;   // scope-excluded at export time; nothing to link
          // Count INSERTS, not attempts: a conflict here inserted nothing, and §8.6 requires a
          // merge preview's counts to equal what the confirmed run does. Same read-back idiom
          // as step 5's role insert.
          const [link] = await tx.insert(workflowEnvironment)
            .values({ workflowId: entry.workflowId, environmentSpecId: envId, source: ref.source })
            .onConflictDoNothing()
            .returning({ workflowId: workflowEnvironment.workflowId });
          if (link) report.links.created++;
          else report.links.alreadyPresent++;
        }
      }
    }

    // 5. Missing role definitions, by name. role.name is globally UNIQUE, which is what makes
    //    it a sound natural key — and what makes onConflictDoNothing the right idempotency.
    let roleIdByName = new Map<string, string>();
    if (pkg.roles.length) {
      const names = pkg.roles.map((r) => r.name);
      const existing = await tx.select({ id: role.id, name: role.name })
        .from(role).where(inArray(role.name, names));
      const idByName = new Map(existing.map((r) => [r.name, r.id]));
      for (const r of pkg.roles) {
        if (idByName.has(r.name)) continue;
        const [created] = await tx.insert(role)
          .values({ name: r.name, description: r.description, isSystem: r.isSystem })
          .onConflictDoNothing({ target: role.name })
          .returning({ id: role.id });
        if (created) {
          idByName.set(r.name, created.id);
          report.roles.created++;
        } else {
          // Lost a race with a concurrent import of the same role name.
          const [row] = await tx.select({ id: role.id }).from(role).where(eq(role.name, r.name)).limit(1);
          if (row) idByName.set(r.name, row.id);
        }
      }
      roleIdByName = idByName;
    }

    // §8.6.4 — target-only grants are snapshotted BEFORE the package's grants are applied, and
    // only for entries that already existed. A newly created workflow has none by construction,
    // and reading after step 6 would mean diffing against rows this very import just inserted.
    if (opts.mode === 'merge') {
      // What the package declares, as a set of (workflowId, nodePath, roleName).
      const declared = new Set(pkg.grants.map((g) => JSON.stringify([
        wfIdByKey.get(envKey(g.workCenterPath, g.workflow.oid, g.workflow.version, g.workflow.state)),
        g.nodePath, g.role,
      ])));

      for (const wc of pkg.manifest.workCenters) {
        for (const w of wc.workflows ?? []) {
          const wfId = wfIdByKey.get(envKey(wc.path, w.oid, w.version, w.state));
          if (!wfId || !preExistingWorkflowIds.has(wfId)) continue;

          const nodes = await tx.select({
            id: workflowNode.id, parentNodeId: workflowNode.parentNodeId, name: workflowNode.name,
          }).from(workflowNode).where(eq(workflowNode.workflowId, wfId));
          const pathById = new Map(buildNodePaths(nodes));

          const existing = await tx.select({
            nodeId: workflowAllowedRole.workflowNodeId, roleName: role.name,
          }).from(workflowAllowedRole)
            .innerJoin(role, eq(role.id, workflowAllowedRole.roleId))
            .where(eq(workflowAllowedRole.workflowId, wfId));

          for (const e of existing) {
            const nodePath = pathById.get(e.nodeId);
            if (nodePath == null) {
              // Ambiguous, not unreachable: buildNodePaths returns null both for a broken parent
              // chain AND for a path shared by two siblings (carry-over.ts's own docstring — node
              // names are user-authored and workflow_node is unique on (workflow_id, node_oid),
              // not name). When the PACKAGE also declares a grant at this path, step 6 below
              // already reports "no such node path"; this covers the other case — a target-only
              // grant this import cannot even name, which must not vanish with no signal just
              // because it cannot be compared against `declared`. Merge never deletes, so the
              // grant itself survives in the database regardless; only the report is at stake.
              report.warnings.push(
                `${e.roleName} on an ambiguously named node in ${wc.path} — ${w.oid}@${w.version} `
                + 'could not be checked against the package during merge (grant left in place)',
              );
              continue;
            }
            if (declared.has(JSON.stringify([wfId, nodePath, e.roleName]))) continue;
            report.targetOnlyGrants.push({
              workCenterPath: wc.path,
              workflow: { oid: w.oid, version: w.version, state: w.state },
              nodePath, role: e.roleName,
            });
          }
        }
      }
    }

    // 6. Grants. Node paths are rebuilt from the NEWLY inserted nodes with the same function
    //    the exporter used, so a path that was unambiguous on export resolves here.
    const pathsByWorkflowId = new Map<string, Map<string, string>>();   // wfId → path → nodeId
    for (const g of pkg.grants) {
      const wfId = wfIdByKey.get(envKey(g.workCenterPath, g.workflow.oid, g.workflow.version, g.workflow.state));
      const roleId = roleIdByName.get(g.role);
      if (!wfId || !roleId) {
        report.grants.unresolved.push(
          `${g.role} on ${g.nodePath} in ${g.workCenterPath} (${wfId ? 'unknown role' : 'unknown workflow'})`,
        );
        continue;
      }
      let byPath = pathsByWorkflowId.get(wfId);
      if (!byPath) {
        const nodes = await tx.select({
          id: workflowNode.id, parentNodeId: workflowNode.parentNodeId, name: workflowNode.name,
        }).from(workflowNode).where(eq(workflowNode.workflowId, wfId));
        byPath = new Map<string, string>();
        for (const [id, p] of buildNodePaths(nodes)) if (p !== null) byPath.set(p, id);
        pathsByWorkflowId.set(wfId, byPath);
      }
      const nodeId = byPath.get(g.nodePath);
      if (!nodeId) {
        report.grants.unresolved.push(`${g.role} on ${g.nodePath} in ${g.workCenterPath} (no such node path)`);
        continue;
      }
      // Counts INSERTS, not attempts — see the link insert in step 4.
      const [grant] = await tx.insert(workflowAllowedRole)
        .values({ workflowId: wfId, workflowNodeId: nodeId, roleId })
        .onConflictDoNothing()
        .returning({ id: workflowAllowedRole.id });
      if (grant) report.grants.created++;
      else report.grants.alreadyPresent++;
    }

    // Preview: everything above already ran for real inside this transaction, so the report
    // describes actual work. Throwing discards that work and hands the report back.
    if (opts.mode === 'merge' && !opts.confirmed) throw new PreviewComplete(report);
    return report;
    });
  } catch (err) {
    if (err instanceof PreviewComplete) return err.report;
    throw err;
  }
}
