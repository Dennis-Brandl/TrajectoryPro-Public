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

import { and, eq, inArray, sql } from 'drizzle-orm';
import { workflowInstance, stepInstance, instanceAssignment, LIVE_ASSIGNMENT_STATUSES } from '../db/schema/execution.js';
import { workCenter, workCenterUserRole } from '../db/schema/work-centers.js';
import { waitTimerOf, type GateTimer } from './gate-timer.js';
import type { Schema } from '../db/client.js';
import type { PgDatabase } from 'drizzle-orm/pg-core';
type Db = PgDatabase<any, Schema>;

export interface InboxTask {
  assignmentId: string; stepInstanceId: string; stepOid: string; stepType: string;
  stepName: string | null;
  instanceId: string; runtimeNumber: number; runtimeLabel: string; masterName: string;
  /** Version of the master recipe this runtime was created from (spec 2026-10-09 §5.7). */
  masterVersion: string;
  /** Child-workflow names from the root down to the one holding this step; [] at the root. */
  workflowPath: string[];
  /** When the step last changed state (step_instance.updated_at), ISO. */
  stepUpdatedAt: string;
  offeredAt: string; claimedAt: string | null;
  suggestedForMe: boolean; paused: boolean;
  formDocument: unknown | null;
  yesNoConfig: unknown | null;
  /** Completion-button label authored in Designer's form-designer Actions panel; null = host default. */
  continueLabel: string | null;
}
/** A timed GATE or repeating SCRIPT waiting at this work center (spec 2026-10-13 §5.3, §6.7) — Pilot's Waiting list. */
export interface WaitingStep {
  stepInstanceId: string; instanceId: string; stepOid: string; stepName: string | null;
  runtimeLabel: string; masterName: string; masterVersion: string;
  /** Child-workflow names from the root down to the one holding this gate; [] at the root. */
  workflowPath: string[];
  /** The instance is paused — the timer keeps counting (wall clock) but Continue now is refused. */
  paused: boolean;
  timer: GateTimer;
}

export interface InboxSnapshot {
  workCenterId: string;
  /** Live name, so a rename in Commander reaches an open Pilot (spec 2026-10-09 §5.7). */
  workCenterName: string | null;
  offers: InboxTask[]; myClaims: InboxTask[];
  waiting: WaitingStep[];
}

/** The step's authored completion-button label: the value of its `Button` UI parameter (Designer's
 *  Actions panel writes it; it is exported verbatim in ui_parameter_specifications). Blank or
 *  absent = null, so the host falls back to its own default label. */
export function continueLabelOf(def: Record<string, unknown> | null): string | null {
  const params = def?.ui_parameter_specifications;
  const button = Array.isArray(params)
    ? (params.find((p) => (p as { type?: unknown } | null)?.type === 'Button') as { value?: unknown } | undefined)
    : undefined;
  if (typeof button?.value === 'string' && button.value.trim() !== '') return button.value;
  // A form carried over from the older format may hold its own Continue button block; its label
  // names the step's completion, so the bottom bar shows it instead of the host default.
  for (const block of formBlocks(def?.form_document)) {
    if (block.type === 'button' && block.outputValue === 'continue'
      && typeof block.label === 'string' && block.label.trim() !== '') return block.label;
  }
  return null;
}

/** Every block of a v2 form document, in order; [] for anything malformed. */
function formBlocks(doc: unknown): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return out;
  const sections = (doc as Record<string, unknown>).sections;
  if (!Array.isArray(sections)) return out;
  for (const section of sections as Array<Record<string, unknown> | null>) {
    const rows = section && typeof section === 'object' ? section.rows : undefined;
    if (!Array.isArray(rows)) continue;
    for (const row of rows as Array<Record<string, unknown> | null>) {
      const blocks = row && typeof row === 'object' ? row.blocks : undefined;
      if (!Array.isArray(blocks)) continue;
      for (const block of blocks) if (block && typeof block === 'object' && !Array.isArray(block)) out.push(block);
    }
  }
  return out;
}

/** The list a parameter value holds: the elements of a structured value property (the engine's
 *  `[{name,value}]` JSON, Description already left out) or a plain JSON array of strings. Each
 *  element's value is both label and stored value. null = not a list. */
function listFromParam(raw: unknown): Array<{ label: string; value: string }> | null {
  if (typeof raw !== 'string') return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(parsed)) return null;
  const items: Array<{ label: string; value: string }> = [];
  for (const el of parsed) {
    const v = el && typeof el === 'object' ? (el as { value?: unknown }).value : el;
    if (v === null || v === undefined || typeof v === 'object') continue;
    items.push({ label: String(v), value: String(v) });
  }
  return items;
}

/** Walk the frozen control-recipe tree for the spec node whose oid matches `nodeOid`, then find
 *  the step within its `steps` array whose oid matches `stepOid`. null = unknown (node/step not
 *  found in the frozen spec — callers treat that as "no payload metadata available"). */
export function findStepDef(specJsonb: unknown, nodeOid: string, stepOid: string): Record<string, unknown> | null {
  const visit = (spec: unknown): Record<string, unknown> | null => {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return null;
    const s = spec as Record<string, unknown>;
    if (s.oid === nodeOid && Array.isArray(s.steps)) {
      const step = (s.steps as Array<Record<string, unknown>>).find((st) => st?.oid === stepOid);
      return step ?? null;
    }
    if (Array.isArray(s.children)) for (const c of s.children) { const hit = visit(c); if (hit) return hit; }
    return null;
  };
  return visit(specJsonb);
}

/** Names (local_id) of the child workflows from the frozen recipe's root down to the node
 *  whose oid is `nodeOid` — [] when the step sits in the root workflow or the node is not
 *  found. A child with no local_id shows as "Sub-workflow" rather than vanishing from the path. */
export function workflowPathOf(specJsonb: unknown, nodeOid: string): string[] {
  const visit = (spec: unknown, trail: string[]): string[] | null => {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return null;
    const s = spec as Record<string, unknown>;
    if (s.oid === nodeOid) return trail;
    if (!Array.isArray(s.children)) return null;
    for (const c of s.children) {
      const name = (c as { local_id?: unknown } | null)?.local_id;
      const hit = visit(c, [...trail, typeof name === 'string' && name.trim() !== '' ? name : 'Sub-workflow']);
      if (hit) return hit;
    }
    return null;
  };
  return visit(specJsonb, []) ?? [];
}

const TOKEN_RE = /\{\{([^{}]+)\}\}/g;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Replace {{ParamName}} tokens in text/header block content with HTML-escaped resolved
 *  input-parameter values (spec 2026-08-11 §4), and fill input-sourced lists (listSource). Exact-name match only; unknown tokens stay
 *  verbatim (visible authoring-error signal); a single replace pass, so values containing
 *  brace syntax are never re-scanned. Walks only shapes it recognizes — anything malformed
 *  returns the input unchanged (same degrade-to-noop stance as the engine's getFormElements).
 *  Never mutates its input: the substituted document is a deep copy. */
export function substituteFormDocumentParams(doc: unknown, params: Record<string, string>): unknown {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return doc;
  if (!Array.isArray((doc as Record<string, unknown>).sections)) return doc;
  const copy = structuredClone(doc) as Record<string, unknown>;
  for (const block of formBlocks(copy)) {
    // A dropdown, combo box, checkbox or radio whose list comes from an input parameter gets
    // that parameter's elements; static lists and unresolvable values stay as authored.
    const source = block.listSource as { mode?: unknown; value?: unknown } | undefined;
    if (source?.mode === 'input' && typeof source.value === 'string'
      && Object.prototype.hasOwnProperty.call(params, source.value)) {
      const items = listFromParam(params[source.value]);
      if (items) {
        if (block.type === 'textInput') block.listItems = items;
        else if (block.type === 'checkbox' || block.type === 'radio') block.options = items;
      }
    }
    if (block.type !== 'text' && block.type !== 'header') continue;
    if (typeof block.content !== 'string') continue;
    // String() coercion: params comes off engine_state jsonb, so a hand-crafted spec
    // could smuggle a non-string default through — without it, escapeHtml's .replace
    // would throw and 500 the ENTIRE work-center inbox, violating this walk's
    // degrade-to-noop stance (deferred final-review finding M3).
    block.content = block.content.replace(TOKEN_RE, (match, name: string) =>
      Object.prototype.hasOwnProperty.call(params, name) ? escapeHtml(String(params[name])) : match);
  }
  return copy;
}

/** Inbox-side application: pick the step's activation-time input snapshot off engine_state
 *  (written by the engine at step activation — transition.ts stepSnapshots) and substitute.
 *  Legacy instances without a snapshot ship the document verbatim. */
function substituteTaskDocument(doc: unknown, engineState: unknown, stepOid: string): unknown {
  if (doc === null) return null;
  const snapshots = (engineState as { stepSnapshots?: Record<string, { inputParameters?: Record<string, string> }> } | null)
    ?.stepSnapshots;
  const params = snapshots?.[stepOid]?.inputParameters;
  return params ? substituteFormDocumentParams(doc, params) : doc;
}

/** The single assignment-visibility rule (spec 2026-08-19 §1.1): shared by the inbox
 *  builder and the Workflows-tab DAOs so "mine" can never drift from what the inbox
 *  actually shows. claimed = the claimant's, regardless of step state (the inbox adds
 *  its own WAITING_USER|PAUSED narrowing on top); offered = parked for an operator
 *  (WAITING_USER) and role-eligible (empty allow-list = everyone). */
export function isAssignmentVisibleTo(
  a: { status: string; assignedUserId: string | null; allowedRoleIds: string[] },
  stepState: string,
  userId: string,
  myRoleIds: ReadonlySet<string>,
): boolean {
  if (a.status === 'claimed') return a.assignedUserId === userId;
  if (a.status === 'offered') {
    return stepState === 'WAITING_USER'
      && (a.allowedRoleIds.length === 0 || a.allowedRoleIds.some((id) => myRoleIds.has(id)));
  }
  return false;
}

const LIVE_INSTANCE_STATUSES = ['running', 'pausing', 'paused', 'resuming'] as const;

// Any timed gate or repeating script anywhere in the frozen recipe — evaluated by Postgres, so an
// instance whose waits are all plain condition gates never ships its spec_jsonb to this
// every-refresh path.
const HAS_TIMED_WAIT = sql`(jsonb_path_exists(${workflowInstance.specJsonb}, '$.**.gate_config.mode ? (@ == "timer" || @ == "condition_or_timer")') OR jsonb_path_exists(${workflowInstance.specJsonb}, '$.**.script_config.repeat'))`;

export async function listWaitingTimedSteps(db: Db, workCenterId: string): Promise<WaitingStep[]> {
  const rows = await db.select({
    stepInstanceId: stepInstance.id, stepOid: stepInstance.stepOid, nodeOid: stepInstance.nodeOid,
    startedAt: stepInstance.startedAt, state: stepInstance.state,
    instanceId: workflowInstance.id, status: workflowInstance.status,
    runtimeLabel: workflowInstance.runtimeLabel, masterName: workflowInstance.masterName,
    masterVersion: workflowInstance.masterVersion,
    armedGates: sql<Record<string, { open?: boolean }> | null>`${workflowInstance.engineState}->'armedGates'`,
  }).from(stepInstance)
    .innerJoin(workflowInstance, eq(stepInstance.workflowInstanceId, workflowInstance.id))
    .where(and(
      eq(workflowInstance.workCenterId, workCenterId),
      inArray(stepInstance.state, ['WAITING_GATE', 'WAITING_SCRIPT']),
      inArray(workflowInstance.status, [...LIVE_INSTANCE_STATUSES]),
      HAS_TIMED_WAIT,
    ));
  if (rows.length === 0) return [];
  // One spec per instance, however many of its gates are waiting.
  const specRows = await db.select({ id: workflowInstance.id, specJsonb: workflowInstance.specJsonb })
    .from(workflowInstance).where(inArray(workflowInstance.id, [...new Set(rows.map((r) => r.instanceId))]));
  const specById = new Map(specRows.map((r) => [r.id, r.specJsonb]));
  const out: WaitingStep[] = [];
  for (const r of rows) {
    const specJsonb = specById.get(r.instanceId);
    const def = findStepDef(specJsonb, r.nodeOid, r.stepOid);
    // Null for a plain condition gate (not the operator's to continue), for an armed gate that
    // has already opened (it is only waiting for its action to stop) and for a one-shot script.
    const timer = waitTimerOf(r.state, def, r.startedAt, r.armedGates?.[r.stepOid]);
    if (!timer) continue;
    out.push({
      stepInstanceId: r.stepInstanceId, instanceId: r.instanceId, stepOid: r.stepOid,
      stepName: typeof def?.local_id === 'string' ? def.local_id : null,
      runtimeLabel: r.runtimeLabel, masterName: r.masterName, masterVersion: r.masterVersion,
      workflowPath: workflowPathOf(specJsonb, r.nodeOid),
      paused: r.status !== 'running', timer,
    });
  }
  // Soonest deadline first; a repeating script with no time limit has none, so it goes last.
  return out.sort((a, b) => {
    const da = a.timer.deadline;
    const db_ = b.timer.deadline;
    if (da === db_) return 0;
    if (da === null) return 1;
    if (db_ === null) return -1;
    return da.localeCompare(db_);
  });
}

export async function buildInbox(db: Db, userId: string, workCenterId: string): Promise<InboxSnapshot> {
  // Spec 2026-09-06: roles are held per work center — only roles held HERE count.
  const myRoles = new Set((await db.select({ roleId: workCenterUserRole.roleId }).from(workCenterUserRole)
    .where(and(eq(workCenterUserRole.workCenterId, workCenterId), eq(workCenterUserRole.userId, userId)))).map((r) => r.roleId));

  const rows = await db.select({
    a: instanceAssignment,
    step: stepInstance,
    instanceId: workflowInstance.id,
    runtimeNumber: workflowInstance.runtimeNumber,
    runtimeLabel: workflowInstance.runtimeLabel,
    masterName: workflowInstance.masterName,
    masterVersion: workflowInstance.masterVersion,
    specJsonb: workflowInstance.specJsonb,
    engineState: workflowInstance.engineState,
  }).from(instanceAssignment)
    .innerJoin(stepInstance, eq(instanceAssignment.stepInstanceId, stepInstance.id))
    .innerJoin(workflowInstance, eq(stepInstance.workflowInstanceId, workflowInstance.id))
    .where(and(
      eq(instanceAssignment.workCenterId, workCenterId),
      inArray(instanceAssignment.status, [...LIVE_ASSIGNMENT_STATUSES]),
    ));

  const toTask = (r: (typeof rows)[number]): InboxTask => {
    const def = findStepDef(r.specJsonb, r.step.nodeOid, r.step.stepOid);
    return {
      assignmentId: r.a.id, stepInstanceId: r.step.id, stepOid: r.step.stepOid,
      stepType: r.step.stepType,
      // MasterWorkflowStep has no `name` — display name is `local_id` (inherited from
      // ManagedElement; see spec/types.ts and transition.ts's own `trigger_step_name` usage).
      stepName: typeof def?.local_id === 'string' ? def.local_id : null,
      instanceId: r.instanceId, runtimeNumber: r.runtimeNumber, runtimeLabel: r.runtimeLabel, masterName: r.masterName,
      masterVersion: r.masterVersion,
      workflowPath: workflowPathOf(r.specJsonb, r.step.nodeOid),
      stepUpdatedAt: r.step.updatedAt.toISOString(),
      offeredAt: r.a.assignedAt.toISOString(), claimedAt: r.a.claimedAt?.toISOString() ?? null,
      suggestedForMe: r.a.preferredUserId === userId, paused: r.step.state === 'PAUSED',
      formDocument: substituteTaskDocument(def?.form_document ?? null, r.engineState, r.step.stepOid),
      yesNoConfig: def?.yes_no_config ?? null,
      continueLabel: continueLabelOf(def),
    };
  };

  const offers = rows
    .filter((r) => r.a.status === 'offered'
      && isAssignmentVisibleTo(r.a, r.step.state, userId, myRoles))
    .map(toTask)
    .sort((x, y) => Number(y.suggestedForMe) - Number(x.suggestedForMe) || x.offeredAt.localeCompare(y.offeredAt));

  const myClaims = rows
    .filter((r) => r.a.status === 'claimed'
      && isAssignmentVisibleTo(r.a, r.step.state, userId, myRoles)
      && (r.step.state === 'WAITING_USER' || r.step.state === 'PAUSED'))
    .map(toTask)
    .sort((x, y) => (x.claimedAt ?? '').localeCompare(y.claimedAt ?? ''));

  const [wcRow] = await db.select({ name: workCenter.name }).from(workCenter).where(eq(workCenter.id, workCenterId));
  return { workCenterId, workCenterName: wcRow?.name ?? null, offers, myClaims, waiting: await listWaitingTimedSteps(db, workCenterId) };
}
