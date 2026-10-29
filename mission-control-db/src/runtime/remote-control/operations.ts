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

import { and, eq } from 'drizzle-orm';
import { workflowInstance, runtimeHistory } from '../../db/schema/index.js';
import { createRuntimeWorkflow, deleteRuntimeWorkflow, requestStart } from '../../dao/runtime-workflows.js';
import { requestAbort, requestPause, requestResume, requestStop } from '../../dao/runtime-control.js';
import { DaoError, pgErrorCode } from '../../dao/errors.js';
import { workflowOutputs } from '../workflow-outputs.js';
import { REMOTE_CODES, RemoteError, runtimeStateName } from './codes.js';
import { parseStartingParameters } from './params.js';
import { getActionMatchingMode } from '../../dao/system-settings.js';
import { resolveMasterWorkflow, resolveRuntime, resolveWorkCenter, type Db, type RuntimeTarget } from './resolve.js';
import { assertCreationAllowed, authorize, type Caller } from './authority.js';

export type RuntimeRef = { id: string; label: string; state: string };

const FINAL = new Set(['completed', 'stopped', 'aborted', 'errored']);

/** A history row outlives its work center (work_center_id SET NULL); such a runtime is out of reach. */
function wcOf(t: RuntimeTarget): string {
  if (!t.workCenterId) throw new RemoteError(REMOTE_CODES.NOT_FOUND, `Runtime ${t.label}: its work center no longer exists`);
  return t.workCenterId;
}

async function liveRef(db: Db, id: string): Promise<RuntimeRef> {
  const [row] = await db.select({ label: workflowInstance.runtimeLabel, status: workflowInstance.status })
    .from(workflowInstance).where(eq(workflowInstance.id, id));
  return { id, label: row?.label ?? '', state: runtimeStateName(row?.status) };
}

function daoToRemote(err: unknown): never {
  if (err instanceof DaoError) {
    if (err.code === 'RUNTIME_PARAM_INVALID') throw new RemoteError(REMOTE_CODES.INVALID_INPUT, `Starting parameters: ${err.message}`);
    if (err.code === 'RUNTIME_NOT_FOUND' || err.code === 'RUNTIME_MASTER_NOT_FOUND') throw new RemoteError(REMOTE_CODES.NOT_FOUND, err.message);
    if (err.code === 'RUNTIME_INVALID_STATE') throw new RemoteError(REMOTE_CODES.WRONG_STATE, `The runtime changed state; ${err.message}`);
    if (err.code === 'WORK_CENTER_NOT_FOUND') throw new RemoteError(REMOTE_CODES.NOT_FOUND, `Work center not found: ${err.message}`);
    if (err.code === 'RUNTIME_MASTER_INVALID') throw new RemoteError(REMOTE_CODES.ERROR, `The Master Workflow cannot be run: ${err.message}`);
  }
  throw err;
}

/** The runtime this caller's step ACTIVATION already created, if any (step id + started_at). */
async function createdByActivation(db: Db, caller: Caller): Promise<string | undefined> {
  const [row] = await db.select({ id: workflowInstance.id }).from(workflowInstance)
    .where(and(eq(workflowInstance.createdByStepInstanceId, caller.stepInstanceId),
      eq(workflowInstance.createdByStepStartedAt, caller.stepStartedAt)));
  return row?.id;
}

/** Create Runtime Workflow / Create and Start Runtime Workflow (spec §1, R2–R5, R7). */
export async function createRuntime(db: Db, caller: Caller, input: {
  workCenter: string; workflow: string; startingParameters: string; start: boolean; now: Date;
}): Promise<RuntimeRef> {
  const existing = await createdByActivation(db, caller);
  // A re-invoke within the same activation: exactly once — the FIRST result is returned as it
  // stands, so a retried Create-and-Start whose child is still Created returns it without
  // starting it (the retry's `start` is not re-applied).
  if (existing) return liveRef(db, existing);
  const wc = await resolveWorkCenter(db, input.workCenter, caller.workCenterId);
  await authorize(db, caller, wc.id, 'create');
  await assertCreationAllowed(db, caller);
  if (input.workflow.trim() === '') throw new RemoteError(REMOTE_CODES.INVALID_INPUT, 'Workflow name is blank');
  const master = await resolveMasterWorkflow(db, wc.id, input.workflow, input.now);
  const params = parseStartingParameters(input.startingParameters);
  // Loose matching: a whole Value Property may carry entries the child does not declare
  // ("Cost" in a PizzaOrder); they are dropped. Strict still rejects them.
  const ignoreUnknownParams = (await getActionMatchingMode(db)) === 'loose';
  try {
    const created = await createRuntimeWorkflow(db, {
      workflowId: master.id, params, userId: null, start: input.start, triggeredBy: 'workflow', ignoreUnknownParams,
      createdBy: {
        instanceId: caller.instanceId, stepInstanceId: caller.stepInstanceId, stepStartedAt: caller.stepStartedAt,
        label: `${caller.workCenterName}/${caller.runtimeLabel}`,
      },
    });
    return { id: created.id, label: created.runtimeLabel, state: runtimeStateName(created.status) };
  } catch (err) {
    if (pgErrorCode(err) === '23505') {
      const raced = await createdByActivation(db, caller);
      if (raced) return liveRef(db, raced);
    }
    daoToRemote(err);
  }
}

export type CommandVerb = 'start' | 'stop' | 'abort' | 'suspend' | 'unsuspend';

const wrong = (t: RuntimeTarget, state: string, verb: CommandVerb) =>
  new RemoteError(REMOTE_CODES.WRONG_STATE, `Cannot ${verb} runtime ${t.label}: it is ${state}`);

/** Start / Stop / Abort / Suspend / Unsuspend (spec §2.1 as resolved by ruling R6). */
export async function commandRuntime(db: Db, caller: Caller, ref: string, verb: CommandVerb): Promise<RuntimeRef> {
  const t = await resolveRuntime(db, ref, caller.workCenterId);
  await authorize(db, caller, wcOf(t), 'command', t.id);
  if (!t.live) {
    const state = runtimeStateName(t.finalState);
    if (verb === 'stop' || verb === 'abort') return { id: t.id, label: t.label, state };
    throw wrong(t, state, verb);
  }
  const status = t.live.status;
  const done = (s: string): RuntimeRef => ({ id: t.id, label: t.label, state: runtimeStateName(s) });
  const finished = FINAL.has(status);
  try {
    switch (verb) {
      case 'start':
        if (status === 'pending') { await requestStart(db, t.id, null); return liveRef(db, t.id); }
        if (['queued', 'running', 'pausing', 'paused', 'resuming'].includes(status)) return done(status);
        throw wrong(t, runtimeStateName(status), verb);
      case 'stop':
        if (finished || status === 'stopping') return done(status);
        if (status === 'pending') { await deleteRuntimeWorkflow(db, t.id); return { id: t.id, label: t.label, state: 'Stopped' }; }
        if (status === 'queued') { await requestAbort(db, t.id); return liveRef(db, t.id); }
        if (['running', 'paused', 'pausing'].includes(status)) { await requestStop(db, t.id); return liveRef(db, t.id); }
        throw wrong(t, runtimeStateName(status), verb);
      case 'abort':
        if (finished || status === 'aborting') return done(status);
        if (status === 'pending') { await deleteRuntimeWorkflow(db, t.id); return { id: t.id, label: t.label, state: 'Aborted' }; }
        await requestAbort(db, t.id); return liveRef(db, t.id);
      case 'suspend':
        if (status === 'running') { await requestPause(db, t.id); return liveRef(db, t.id); }
        if (status === 'pausing' || status === 'paused') return done(status);
        throw wrong(t, runtimeStateName(status), verb);
      case 'unsuspend':
        if (status === 'paused') { await requestResume(db, t.id); return liveRef(db, t.id); }
        if (status === 'running' || status === 'resuming') return done(status);
        throw wrong(t, runtimeStateName(status), verb);
    }
  } catch (err) {
    daoToRemote(err);
  }
}

/** Get Runtime Workflow Status (R1). Read access: same work center or any grant. */
export async function getRuntimeState(db: Db, caller: Caller, ref: string): Promise<RuntimeRef & { finished: boolean }> {
  const t = await resolveRuntime(db, ref, caller.workCenterId);
  await authorize(db, caller, wcOf(t), 'read', t.id);
  const status = t.live?.status ?? t.finalState;
  return { id: t.id, label: t.label, state: runtimeStateName(status), finished: !t.live || FINAL.has(t.live.status) };
}

/** Get Runtime Workflow Outputs (R9, spec §6.2). */
export async function getRuntimeOutputs(db: Db, caller: Caller, ref: string): Promise<RuntimeRef & { outputs: Array<{ name: string; value: string }> }> {
  const t = await resolveRuntime(db, ref, caller.workCenterId);
  await authorize(db, caller, wcOf(t), 'read', t.id);
  if (t.live) {
    const [row] = await db.select({ spec: workflowInstance.specJsonb, store: workflowInstance.propertyStore })
      .from(workflowInstance).where(eq(workflowInstance.id, t.id));
    return { id: t.id, label: t.label, state: runtimeStateName(t.live.status), outputs: workflowOutputs(row?.spec, (row?.store as Record<string, string> | null) ?? {}) };
  }
  const [h] = await db.select({ outputs: runtimeHistory.outputs }).from(runtimeHistory).where(eq(runtimeHistory.workflowInstanceId, t.id));
  if (!h?.outputs) throw new RemoteError(REMOTE_CODES.NOT_FOUND, `Runtime ${t.label}: outputs were not recorded (it finished before this version)`);
  return { id: t.id, label: t.label, state: runtimeStateName(t.finalState), outputs: h.outputs as Array<{ name: string; value: string }> };
}
