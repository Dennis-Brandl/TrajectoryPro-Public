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

// Enable: freeze a Master Schedule into a Runtime Schedule (spec 2026-11-08 §5.4). Every
// workflow is resolved and its spec copied, every value is checked, and all problems come
// back together or the Runtime is created, in one transaction.

import { and, eq, inArray, or, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { Schema } from '../db/client.js';
import { workCenter, workflow, masterSchedule, runtimeSchedule, runtimeScheduleItem } from '../db/schema/index.js';
import { DaoError, pgViolates } from '../dao/errors.js';
import { startingParameterSpecs, validateStartingParams, type StartingParameterSpec } from '../runtime/instantiate.js';
import { REMOTE_CODES, RemoteError } from '../runtime/remote-control/codes.js';
import { resolveMasterWorkflow } from '../runtime/remote-control/resolve.js';
import type { DefinitionProblem, ScheduleItemInput } from './definition.js';
import { appendScheduleEvent, type ScheduleActor } from './events.js';
import { definitionHash, definitionOf, getMasterSchedule, type MasterScheduleView } from './master-dao.js';
import { describeInstant, localToInstant, nextOccurrence, type Recurrence, type Slot } from './recurrence.js';
import { effectiveTimeZone, loadRuntimeScheduleView, type RuntimeScheduleView } from './runtime-dao.js';
import type { ValueSource } from './values.js';

type Db = PgDatabase<any, Schema>;

const LIVE_ONE_PER_MASTER = 'runtime_schedule_one_live_per_master_uq';
const LIVE_ONE_PER_KEY = 'runtime_schedule_one_live_per_key_uq';
const RUN_ONCE_REQUEST = 'runtime_schedule_run_once_request_uq';
const PREVIEW_FIRE_TIMES = 5;
const TRIGGER_REF = /^trigger\.(input|output)\.(.+)$/;

type FrozenWorkflow = { id: string; oid: string; name: string; version: string; state: string; spec: unknown };
type FrozenNode = {
  path: string;
  input: ScheduleItemInput;
  wf: FrozenWorkflow | null;
  params: Record<string, ValueSource>;
  children: FrozenNode[];
};
type Plan = {
  problems: DefinitionProblem[];
  warnings: string[];
  nodes: FrozenNode[];
  zone: string;
  firstFire: Slot | null;
};

/** Parameter names this value source takes from the triggering run. */
function triggerRefs(src: ValueSource): Array<{ kind: 'input' | 'output'; name: string }> {
  if ('from' in src) {
    return src.from === 'trigger.input' || src.from === 'trigger.output'
      ? [{ kind: src.from === 'trigger.input' ? 'input' : 'output', name: src.name }] : [];
  }
  if ('template' in src) {
    return [...src.template.matchAll(/\{([^{}]*)\}/g)].flatMap((m) => {
      const hit = TRIGGER_REF.exec(m[1] as string);
      return hit ? [{ kind: hit[1] as 'input' | 'output', name: hit[2] as string }] : [];
    });
  }
  return [];
}

const pickKey = (it: ScheduleItemInput) => JSON.stringify([it.workflow.name, it.workflow.version ?? null]);

function outputIds(spec: unknown): Set<string> {
  const list = (spec as { output_parameter_specifications?: unknown } | null)?.output_parameter_specifications;
  const ids = new Set<string>();
  if (Array.isArray(list)) for (const o of list) if (typeof (o as { id?: unknown })?.id === 'string') ids.add((o as { id: string }).id);
  return ids;
}

async function plan(db: Db, master: MasterScheduleView, now: Date, lock: boolean, runOnce = false): Promise<Plan> {
  const problems: DefinitionProblem[] = [];
  const add = (path: string, code: string, message: string) => problems.push({ path, code, message });

  // 1. Resolve each item (pinned or current), remembering the problems.
  type Pick = { id: string; version: string; state: string };
  const picks = new Map<string, Pick | { code: string; message: string }>();
  const visit = async (list: ScheduleItemInput[], base: string): Promise<void> => {
    for (const [i, it] of list.entries()) {
      const path = `${base}[${i}]`;
      const key = pickKey(it);
      if (!picks.has(key)) {
        try {
          picks.set(key, await resolveMasterWorkflow(db, master.workCenterId, it.workflow.name, now, it.workflow.version));
        } catch (e) {
          if (!(e instanceof RemoteError)) throw e;
          picks.set(key, { code: e.code === REMOTE_CODES.WRONG_STATE ? 'WORKFLOW_UNUSABLE' : 'WORKFLOW_NOT_FOUND', message: e.message });
        }
      }
      const p = picks.get(key)!;
      if ('code' in p) add(`${path}.workflow`, p.code, p.message);
      if (it.chain?.length) await visit(it.chain, `${path}.chain`);
    }
  };
  await visit(master.items, 'items');

  // 2. Lock (Enable only) and read the chosen rows, in id order.
  const ids = [...new Set([...picks.values()].flatMap((p) => ('id' in p ? [p.id] : [])))].sort();
  const rows = new Map<string, FrozenWorkflow>();
  if (ids.length) {
    const q = db.select({
      id: workflow.id, oid: workflow.oid, name: workflow.name, version: workflow.version,
      state: workflow.state, spec: workflow.specJsonb,
    }).from(workflow).where(inArray(workflow.id, ids)).orderBy(workflow.id);
    for (const r of await (lock ? q.for('share') : q)) rows.set(r.id, r);
  }

  // 3. Build the frozen tree and validate it.
  const warned = new Set<string>();
  const warnings: string[] = [];
  const build = (list: ScheduleItemInput[], base: string, parent: FrozenNode | null): FrozenNode[] =>
    list.map((it, i) => {
      const path = `${base}[${i}]`;
      const found = picks.get(pickKey(it))!;
      const pick = 'id' in found ? found : null;
      const wf = pick ? rows.get(pick.id) ?? null : null;
      if (pick && !wf) add(`${path}.workflow`, 'WORKFLOW_NOT_FOUND', `Master Workflow "${it.workflow.name}" was removed while enabling`);
      // The state is read again under the lock: a row moved to Superseded or Obsolete since it was picked is refused.
      const moved = wf !== null && (wf.state === 'Superseded' || wf.state === 'Obsolete');
      if (moved) add(`${path}.workflow`, 'WORKFLOW_UNUSABLE', `Master Workflow "${wf.name}" version ${wf.version} is ${wf.state} and cannot be scheduled`);
      const node: FrozenNode = { path, input: it, wf: moved ? null : wf, params: {}, children: [] };
      if (wf && !moved) {
        if (wf.state !== 'Effective' && !warned.has(wf.id)) {
          warned.add(wf.id);
          warnings.push(`"${wf.name}" version ${wf.version} is ${wf.state}, not Effective`);
        }
        const specs = startingParameterSpecs(wf.spec);
        node.params = freezeParams(specs, it.params ?? {}, path, parent, add);
      } else {
        node.params = { ...(it.params ?? {}) };
      }
      node.children = build(it.chain ?? [], `${path}.chain`, node);
      return node;
    });
  const nodes = build(master.items, 'items', null);

  // 4. The first fire. Run Once takes its own time, so the pattern does not matter.
  const zone = await effectiveTimeZone(db, master.workCenterId);
  const firstFire = runOnce ? null : nextOccurrence(master.recurrence, zone, now);
  if (!runOnce && !firstFire) {
    if (master.recurrence.type === 'manual') {
      add('', 'MANUAL_ONLY', 'This is a Manual schedule, so it has no recurrence to enable. Use Run Once.');
    } else {
      add('', 'NO_FUTURE_START', `This schedule has no future start: its times have passed in ${zone}, where it is now ${describeInstant(now, zone)}`);
    }
  }

  return { problems, warnings, nodes, zone, firstFire };
}

/** Fills left-out literal defaults, then checks fixed values and references to the triggering run. */
function freezeParams(
  specs: StartingParameterSpec[], given: Record<string, ValueSource>, path: string, parent: FrozenNode | null,
  add: (path: string, code: string, message: string) => void,
): Record<string, ValueSource> {
  const byId = new Map(specs.map((s) => [s.id, s]));
  const frozen: Record<string, ValueSource> = {};
  for (const s of specs) {
    if (s.value_type === 'literal' && s.default_value !== '' && !Object.hasOwn(given, s.id)) {
      frozen[s.id] = { value: s.default_value };
    }
  }
  Object.assign(frozen, given);

  for (const [id, src] of Object.entries(given)) {
    const at = `${path}.params.${id}`;
    if (!byId.has(id)) {
      add(at, 'PARAM_UNKNOWN', `This workflow has no starting parameter "${id}"`);
      continue;
    }
    if ('value' in src) {
      try {
        validateStartingParams(specs, { [id]: src.value });
      } catch (e) {
        if (!(e instanceof DaoError)) throw e;
        add(at, 'PARAM_INVALID', e.message);
      }
    }
    if (!parent?.wf) continue;
    for (const ref of triggerRefs(src)) {
      if (ref.kind === 'output') {
        if (!outputIds(parent.wf.spec).has(ref.name)) {
          add(at, 'TRIGGER_OUTPUT_UNKNOWN', `"${parent.wf.name}" has no output named "${ref.name}"`);
        }
      } else if (!Object.hasOwn(parent.params, ref.name)) {
        const declared = startingParameterSpecs(parent.wf.spec).find((s) => s.id === ref.name);
        if (!declared) {
          add(at, 'UNKNOWN_PARENT_PARAMETER', `"${parent.wf.name}" has no starting parameter named "${ref.name}"`);
        } else if (declared.value_type === 'property') {
          add(at, 'TRIGGER_INPUT_PROPERTY',
            `"${ref.name}" is read from a property when "${parent.wf.name}" starts, so it is not a recorded starting value; pass it as an output instead`);
        } else {
          add(at, 'TRIGGER_INPUT_NO_VALUE', `"${parent.wf.name}" is given no starting value for "${ref.name}"`);
        }
      }
    }
  }
  return frozen;
}

export async function previewEnable(
  db: Db, masterId: string, now: Date,
): Promise<{ problems: DefinitionProblem[]; warnings: string[]; nextFireTimes: Date[]; timeZone: string }> {
  const master = await getMasterSchedule(db, masterId);
  if (!master) throw new DaoError('MASTER_SCHEDULE_NOT_FOUND');
  const p = await plan(db, master, now, false);
  const nextFireTimes: Date[] = [];
  let after = now;
  while (nextFireTimes.length < PREVIEW_FIRE_TIMES) {
    const slot = nextOccurrence(master.recurrence, p.zone, after);
    if (!slot) break;
    nextFireTimes.push(slot.at);
    after = slot.at;
  }
  return { problems: p.problems, warnings: p.warnings, nextFireTimes, timeZone: p.zone };
}

export async function previewRunOnce(
  db: Db, masterId: string, now: Date,
): Promise<{ problems: DefinitionProblem[]; warnings: string[]; timeZone: string }> {
  const master = await getMasterSchedule(db, masterId);
  if (!master) throw new DaoError('MASTER_SCHEDULE_NOT_FOUND');
  const p = await plan(db, master, now, false, true);
  return { problems: p.problems, warnings: p.warnings, timeZone: p.zone };
}

async function insertNodes(tx: Db, runtimeId: string, nodes: FrozenNode[], parent: string | null): Promise<void> {
  for (const [position, n] of nodes.entries()) {
    const wf = n.wf!;
    const [row] = await tx.insert(runtimeScheduleItem).values({
      runtimeScheduleId: runtimeId, parentItemId: parent, position,
      triggerOn: n.input.triggerOn ?? null, params: n.params,
      workflowId: wf.id, specJsonb: wf.spec,
      masterName: wf.name, masterOid: wf.oid, masterVersion: wf.version, masterState: wf.state,
    }).returning({ id: runtimeScheduleItem.id });
    await insertNodes(tx, runtimeId, n.children, row!.id);
  }
}

/** Writes the frozen Runtime and its items. The work_center lock follows the workflow locks plan() took. */
async function freezeRuntime(tx: Db, master: MasterScheduleView, p: Plan, actor: ScheduleActor, now: Date, how: {
  recurrence: Recurrence; nextFireAt: Date; externalKey: string | null; runOnce: boolean; requestId?: string;
}): Promise<{ id: string; label: string }> {
  const [wc] = await tx.select({ name: workCenter.name }).from(workCenter)
    .where(eq(workCenter.id, master.workCenterId)).for('update');
  if (!wc) throw new DaoError('WORK_CENTER_NOT_FOUND');
  const [{ top }] = await tx.select({ top: sql<number>`coalesce(max(${runtimeSchedule.runtimeNumber}), 0)::int` })
    .from(runtimeSchedule).where(eq(runtimeSchedule.workCenterId, master.workCenterId)) as [{ top: number }];
  const runtimeNumber = top + 1;
  const label = `RS-${runtimeNumber}`;
  const [row] = await tx.insert(runtimeSchedule).values({
    workCenterId: master.workCenterId, workCenterName: wc.name, masterScheduleId: master.id,
    runtimeNumber, label, name: master.name, recurrence: how.recurrence,
    timeZone: p.zone, masterRevision: master.revision, definitionHash: definitionHash(definitionOf(master)),
    externalKey: how.externalKey, runOnce: how.runOnce, runOnceRequestId: how.requestId ?? null, status: 'active', nextFireAt: how.nextFireAt,
    enabledByUser: actor.kind === 'user' ? actor.userId : null,
    enabledByClient: actor.kind === 'api_client' ? actor.clientId : null,
    enabledAt: now,
  }).returning({ id: runtimeSchedule.id });
  await insertNodes(tx, row!.id, p.nodes, null);
  return { id: row!.id, label };
}

/**
 * Run Once: freezes the Master into a Runtime of its own that fires one time, now or at `atLocal`
 * (YYYY-MM-DDTHH:mm in the work center's zone). The engine's tick starts it, like any other slot, and
 * it finishes by itself. It may overlap anything, including another Run Once of the same Master. Its
 * external key stays null, as a re-send compares itself only to Runtimes made by Enable (§8.3).
 *
 * A `requestId` makes a retry safe: the same id on the same Master answers with the first Runtime,
 * `repeated: true`, and starts nothing, whatever else the retry says.
 */
export async function runMasterScheduleOnce(
  db: Db, masterId: string, actor: ScheduleActor, now: Date, atLocal?: string, requestId?: string,
): Promise<{ runtime: RuntimeScheduleView; warnings: string[]; master: MasterScheduleView; repeated: boolean }> {
  try {
    return await startRunOnce(db, masterId, actor, now, atLocal, requestId);
  } catch (err) {
    // Two copies of one request at the same moment: the loser finds what the winner made.
    if (requestId !== undefined && pgViolates(err, RUN_ONCE_REQUEST)) return startRunOnce(db, masterId, actor, now, atLocal, requestId);
    throw err;
  }
}

async function startRunOnce(
  db: Db, masterId: string, actor: ScheduleActor, now: Date, atLocal?: string, requestId?: string,
): Promise<{ runtime: RuntimeScheduleView; warnings: string[]; master: MasterScheduleView; repeated: boolean }> {
  return db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const [locked] = await tx.select({ id: masterSchedule.id }).from(masterSchedule)
      .where(eq(masterSchedule.id, masterId)).for('share');
    if (!locked) throw new DaoError('MASTER_SCHEDULE_NOT_FOUND');
    const master = await getMasterSchedule(tx, masterId);
    if (!master) throw new DaoError('MASTER_SCHEDULE_NOT_FOUND');

    if (requestId !== undefined) {
      const [first] = await tx.select({ id: runtimeSchedule.id }).from(runtimeSchedule)
        .where(and(eq(runtimeSchedule.masterScheduleId, masterId), eq(runtimeSchedule.runOnceRequestId, requestId)));
      if (first) return { runtime: (await loadRuntimeScheduleView(tx, first.id))!, warnings: [], master, repeated: true };
    }

    const p = await plan(tx, master, now, true, true);
    const fireAt = atLocal === undefined ? now : localToInstant(atLocal, p.zone);
    if (fireAt.getTime() < now.getTime()) {
      p.problems.push({
        path: 'at', code: 'RUN_ONCE_TIME_PASSED',
        message: `${atLocal!.replace('T', ' ')} has already passed in ${p.zone}, where it is now ${describeInstant(now, p.zone)}`,
      });
    }
    if (p.problems.length) throw new DaoError('ENABLE_INVALID', 'The schedule cannot be started', p.problems);

    const { id, label } = await freezeRuntime(tx, master, p, actor, now, {
      recurrence: { type: 'runOnce', at: fireAt.toISOString() }, nextFireAt: fireAt, externalKey: null, runOnce: true, requestId,
    });
    await appendScheduleEvent(tx, {
      runtimeScheduleId: id, masterScheduleId: master.id, action: 'run_once', actor,
      detail: { label, name: master.name, masterRevision: master.revision, at: fireAt.toISOString(), warnings: p.warnings },
    });
    return { runtime: (await loadRuntimeScheduleView(tx, id))!, warnings: p.warnings, master, repeated: false };
  });
}

export async function enableMasterSchedule(
  db: Db, masterId: string, actor: ScheduleActor, now: Date,
): Promise<{ runtime: RuntimeScheduleView; warnings: string[]; master: MasterScheduleView }> {
  let warnings: string[] = [];
  try {
    return await db.transaction(async (t) => {
      const tx = t as unknown as Db;
      // Lock the Master first: a concurrent rewrite or delete waits, so the view below is whole.
      const [locked] = await tx.select({ id: masterSchedule.id }).from(masterSchedule)
        .where(eq(masterSchedule.id, masterId)).for('share');
      if (!locked) throw new DaoError('MASTER_SCHEDULE_NOT_FOUND');
      const master = await getMasterSchedule(tx, masterId);
      if (!master) throw new DaoError('MASTER_SCHEDULE_NOT_FOUND');
      const [live] = await tx.select({ label: runtimeSchedule.label }).from(runtimeSchedule)
        .where(and(
          // A Master deleted and sent again by key is a new row, and its old Runtime may still be on.
          or(
            eq(runtimeSchedule.masterScheduleId, masterId),
            master.externalKey === null ? undefined
              : and(eq(runtimeSchedule.workCenterId, master.workCenterId), eq(runtimeSchedule.externalKey, master.externalKey)),
          ),
          inArray(runtimeSchedule.status, ['active', 'paused']),
          eq(runtimeSchedule.runOnce, false),
        ));
      if (live) throw new DaoError('RUNTIME_ACTIVE', `${live.label} is already on for this Master Schedule; cancel it first`);

      // Lock order matches the run creators: workflow rows FOR SHARE (inside plan), then the work_center row.
      const p = await plan(tx, master, now, true);
      if (p.problems.length) throw new DaoError('ENABLE_INVALID', 'The schedule cannot be enabled', p.problems);
      warnings = p.warnings;

      const { id, label } = await freezeRuntime(tx, master, p, actor, now, {
        recurrence: master.recurrence, nextFireAt: p.firstFire!.at, externalKey: master.externalKey, runOnce: false,
      });
      await appendScheduleEvent(tx, {
        runtimeScheduleId: id, masterScheduleId: master.id, action: 'enabled', actor,
        detail: { label, name: master.name, masterRevision: master.revision, warnings },
      });
      return { runtime: (await loadRuntimeScheduleView(tx, id))!, warnings, master };
    });
  } catch (err) {
    if (pgViolates(err, LIVE_ONE_PER_MASTER) || pgViolates(err, LIVE_ONE_PER_KEY)) throw new DaoError('RUNTIME_ACTIVE', 'This Master Schedule is already on; cancel it first');
    throw err;
  }
}
