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

import { eq, inArray, sql, getTableColumns, countDistinct } from 'drizzle-orm';
import {
  workCenter, workCenterUser, workflow, appUser, environmentSpec, role,
  workflowEnvironment, workflowAllowedRole,
  type WorkCenter, type Workflow, type AppUser, type EnvironmentSpec, type Role,
} from '../db/schema/index.js';
import {
  rolesForWorkCenterMembers, workCenterMembershipsForUser, membersForRole,
  type UserWorkCenterMembership, type RoleWorkCenterMembers,
} from './work-center-user-roles.js';
import { subtree } from './work-centers.js';
import { getEnvironmentBinding } from './environment-bindings.js';
import { getActionServerPolicy } from './system-settings.js';
import type { Schema } from '../db/client.js';
import type { PgDatabase } from 'drizzle-orm/pg-core';

type Db = PgDatabase<any, Schema>;

// db.execute()'s return type collapses to `any` when Db uses `PgDatabase<any, Schema>`
// (the query-result HKT generic is erased), so the row shape is asserted explicitly here,
// same pattern as work-centers.ts's subtree() and the work_center_role view test.
type WorkCenterRoleRow = { role_id: string };

export type SubtreeNode = Awaited<ReturnType<typeof subtree>>[number];

// Shared by every view that projects workflow rows for DISPLAY (name, version, state, …)
// and never needs the full spec_jsonb blob those rows also carry. The Diagram tab fetches a
// projected subset from its own route instead.
const { specJsonb: _wfSpec, ...workflowColsNoSpec } = getTableColumns(workflow);

/**
 * A work-center workflow row plus its DISTINCT allowed-role count — how many separate
 * roles may act anywhere in that workflow, so a role granted on three steps counts once.
 *
 * Deliberately NOT folded into the shared `Workflow` type: that type also backs
 * RoleView.workflows and the light picker list, neither of which projects this column,
 * and widening it would misdeclare both payloads.
 */
export type WorkflowWithRoleCount = Omit<Workflow, 'specJsonb'> & { allowedRoleCount: number };

// M6: workflow and environment_spec belong directly to a work center (work_center_id),
// so no join is needed to name their owner's collection, and Designer provenance
// (sourceLibraryName/sourceLibraryOid) is already a plain column on the row — no library
// join required either. The library hierarchy is retired outright (spec §9 "Retired").
export type WorkCenterView = {
  workCenter: WorkCenter;
  subtree: SubtreeNode[];
  workflows: WorkflowWithRoleCount[];
  /** Members with their per-work-center attributes: the commander flag and the roles held HERE. */
  users: (AppUser & { missionSystemCommander: boolean; roles: Role[] })[];
  environments: EnvironmentSpec[];
  /** Roles REFERENCED by this work center's workflows (work_center_role view: allowed roles
   *  and e-signature roles) — not membership. */
  roles: Role[];
};

/** Mission Planner "User" hierarchy (spec 2026-09-06 §4.3): one row per work center the user
 *  belongs to, carrying the commander flag and the roles held there. Roles are never global. */
export type UserView = {
  user: AppUser;
  workCenters: UserWorkCenterMembership[];
};

export type WorkflowView = {
  workflow: Omit<Workflow, 'specJsonb'>;
  workCenter: WorkCenter;
  environments: EnvironmentSpec[];
};

export type RoleView = {
  role: Role;
  /** Who holds this role, grouped by the work center they hold it in. */
  members: RoleWorkCenterMembers[];
  workflows: Omit<Workflow, 'specJsonb'>[];
};

/**
 * Mission Planner "Work Center" hierarchy: the work center, its descendant subtree,
 * and — for that work center specifically — its own workflows and environment specs
 * (owned directly via work_center_id, spec §5), assigned users, and the roles derived
 * from the work_center_role view.
 */
export async function workCenterView(db: Db, workCenterId: string): Promise<WorkCenterView | undefined> {
  const [wc] = await db.select().from(workCenter).where(eq(workCenter.id, workCenterId));
  if (!wc) return undefined;

  const tree = await subtree(db, workCenterId);

  const workflowRows = await db.select(workflowColsNoSpec).from(workflow)
    .where(eq(workflow.workCenterId, workCenterId));

  // One grouped query for the whole work center rather than one per workflow. Skipped
  // entirely when there is nothing to count. Workflows with no grants produce NO row here,
  // which is why the merge below supplies 0 rather than reading a possibly-absent key.
  const roleCounts = workflowRows.length
    ? await db.select({
        workflowId: workflowAllowedRole.workflowId,
        count: countDistinct(workflowAllowedRole.roleId),
      }).from(workflowAllowedRole)
        .where(inArray(workflowAllowedRole.workflowId, workflowRows.map((w) => w.id)))
        .groupBy(workflowAllowedRole.workflowId)
    : [];
  const countByWorkflow = new Map(roleCounts.map((r) => [r.workflowId, r.count]));
  const workflows = workflowRows.map((w) => ({
    ...w, allowedRoleCount: countByWorkflow.get(w.id) ?? 0,
  }));

  const memberRows = await db.select({ ...getTableColumns(appUser), missionSystemCommander: workCenterUser.missionSystemCommander })
    .from(workCenterUser)
    .innerJoin(appUser, eq(appUser.id, workCenterUser.userId))
    .where(eq(workCenterUser.workCenterId, workCenterId));
  const rolesByMember = await rolesForWorkCenterMembers(db, workCenterId);
  const users = memberRows.map((u) => ({ ...u, roles: rolesByMember.get(u.id) ?? [] }));

  const environments = await db.select().from(environmentSpec)
    .where(eq(environmentSpec.workCenterId, workCenterId));

  const roleIdsRes = await db.execute<WorkCenterRoleRow>(
    sql`select role_id from work_center_role where work_center_id = ${workCenterId}`,
  );
  const roleIdRows = roleIdsRes.rows as WorkCenterRoleRow[];
  const roleIds = roleIdRows.map((r) => r.role_id);
  const roles = roleIds.length ? await db.select().from(role).where(inArray(role.id, roleIds)) : [];

  return { workCenter: wc, subtree: tree, workflows, users, environments, roles };
}

/** Mission Planner "User" hierarchy: the user and its work-center memberships (with roles). */
export async function userView(db: Db, userId: string): Promise<UserView | undefined> {
  const [u] = await db.select().from(appUser).where(eq(appUser.id, userId));
  if (!u) return undefined;
  const workCenters = await workCenterMembershipsForUser(db, userId);
  return { user: u, workCenters };
}

/**
 * Mission Planner "Workflow" hierarchy: the workflow, its owning work center (a workflow
 * belongs to exactly one — spec §4.4), and its embedded env specs (workflow_environment,
 * unchanged by M6 — spec §4.5).
 */
export async function workflowView(db: Db, workflowId: string): Promise<WorkflowView | undefined> {
  const rows = await db.select({
    workflow: workflowColsNoSpec,
    workCenter: getTableColumns(workCenter),
  }).from(workflow)
    .innerJoin(workCenter, eq(workCenter.id, workflow.workCenterId))
    .where(eq(workflow.id, workflowId));
  const row = rows[0];
  if (!row) return undefined;
  const { workflow: wf, workCenter: wc } = row;

  const environments = await db.select(getTableColumns(environmentSpec))
    .from(workflowEnvironment)
    .innerJoin(environmentSpec, eq(environmentSpec.id, workflowEnvironment.environmentSpecId))
    .where(eq(workflowEnvironment.workflowId, workflowId));

  return { workflow: wf, workCenter: wc, environments };
}

export type EnvSpecView = {
  environmentSpec: EnvironmentSpec;
  workCenter: WorkCenter;
  workflows: Workflow[];
  /** One per spec_jsonb.included_actions[] entry, in order. */
  actions: EnvSpecAction[];
  /** spec_jsonb.action_server_specifications[] (blank strings are legal). */
  actionServers: { name: string; uri: string }[];
  /** This work center's binding for the environment; null when none is set. */
  binding: { serverUri: string; allowlisted: boolean } | null;
};

export type EnvSpecAction = {
  name: string; library: string | null; version: string | null; description: string | null;
  visibility: string | null; inputs: string[]; outputs: string[];
};

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const paramIds = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((p: any) => (p && typeof p.id === 'string' ? p.id : null)).filter((x): x is string => x !== null) : [];

/**
 * Mission Planner "Environment" hierarchy: the env spec, its owning work center (an env
 * spec belongs to exactly one — spec §5), and the workflows that embed it
 * (workflow_environment, unchanged by M6).
 */
export async function envSpecView(db: Db, environmentSpecId: string): Promise<EnvSpecView | undefined> {
  const rows = await db.select({
    environmentSpec: getTableColumns(environmentSpec),
    workCenter: getTableColumns(workCenter),
  }).from(environmentSpec)
    .innerJoin(workCenter, eq(workCenter.id, environmentSpec.workCenterId))
    .where(eq(environmentSpec.id, environmentSpecId));
  const row = rows[0];
  if (!row) return undefined;
  const { environmentSpec: es, workCenter: wc } = row;

  const workflows = await db.select(getTableColumns(workflow))
    .from(workflowEnvironment)
    .innerJoin(workflow, eq(workflow.id, workflowEnvironment.workflowId))
    .where(eq(workflowEnvironment.environmentSpecId, environmentSpecId));

  const spec: any = es.specJsonb && typeof es.specJsonb === 'object' ? es.specJsonb : {};
  const actions: EnvSpecAction[] = (Array.isArray(spec.included_actions) ? spec.included_actions : [])
    .filter((a: any) => a && typeof a === 'object')
    .map((a: any) => ({
      name: str(a.action_name) ?? str(a.local_id) ?? '',
      library: str(a.action_library),
      version: str(a.version),
      description: str(a.description),
      visibility: str(a.action_visibility),
      inputs: paramIds(a.input_parameter_specifications),
      outputs: paramIds(a.output_parameter_specifications),
    }));
  const actionServers = (Array.isArray(spec.action_server_specifications) ? spec.action_server_specifications : [])
    .filter((a: any) => a && typeof a === 'object')
    .map((a: any) => ({ name: str(a.name) ?? '', uri: str(a.uri) ?? '' }));

  let binding: EnvSpecView['binding'] = null;
  const serverUri = await getEnvironmentBinding(db, wc.id, es.oid);
  if (serverUri) {
    const policy = await getActionServerPolicy(db);
    let origin: string | null = null;
    try { origin = new URL(serverUri).origin; } catch { /* unparseable: not allowlisted */ }
    binding = { serverUri, allowlisted: policy.trust === 'loose' || (origin !== null && policy.allowlist.includes(origin)) };
  }

  return { environmentSpec: es, workCenter: wc, workflows, actions, actionServers, binding };
}

/**
 * Mission Planner "Role" hierarchy: the role, who holds it, grouped by work center, and
 * the workflows that use it (via workflow_allowed_role, which now references the workflow
 * directly — spec §4.3).
 */
export async function roleView(db: Db, roleId: string): Promise<RoleView | undefined> {
  const [r] = await db.select().from(role).where(eq(role.id, roleId));
  if (!r) return undefined;

  const members = await membersForRole(db, roleId);

  const workflows = await db.selectDistinct(workflowColsNoSpec)
    .from(workflowAllowedRole)
    .innerJoin(workflow, eq(workflow.id, workflowAllowedRole.workflowId))
    .where(eq(workflowAllowedRole.roleId, roleId));

  return { role: r, members, workflows };
}
