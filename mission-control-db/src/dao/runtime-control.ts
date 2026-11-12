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
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { workflowInstance, appUser } from '../db/schema/index.js';
import { runtimeControlEvent } from '../db/schema/execution.js';
import type { ControlActor, ControlEffect, ControlVerb } from './control-events.js';
import { DaoError } from './errors.js';
import type { Schema } from '../db/client.js';

type Db = PgDatabase<any, Schema>;

async function requestTransition(db: Db, instanceId: string, from: readonly string[], to: string, verb: string): Promise<void> {
  const res = await db.update(workflowInstance)
    .set({ status: to, updatedAt: new Date() })
    .where(and(eq(workflowInstance.id, instanceId), inArray(workflowInstance.status, [...from])))
    .returning({ id: workflowInstance.id });
  if (res.length > 0) return;
  const row = await db.select({ status: workflowInstance.status }).from(workflowInstance).where(eq(workflowInstance.id, instanceId));
  if (row.length === 0) throw new DaoError('RUNTIME_NOT_FOUND');
  throw new DaoError('RUNTIME_INVALID_STATE', `cannot ${verb} from ${row[0].status}`);
}

export const requestPause = (db: Db, id: string) => requestTransition(db, id, ['running'], 'pausing', 'pause');
export const requestResume = (db: Db, id: string) => requestTransition(db, id, ['paused'], 'resuming', 'resume');

type ControlRule = { from: readonly string[]; to: string; effect: ControlEffect };

/** Stop/Abort/skip-cleanup: the status flip, the optional cleanup_skip set, and the audit row
 *  (spec 2026-11-06 U7/U8) in ONE transaction; a refusal writes nothing. The first rule whose
 *  `from` list holds the current status wins. */
async function controlTransition(
  db: Db, instanceId: string, verb: ControlVerb, label: string, rules: readonly ControlRule[],
  actor: ControlActor, skip: ControlVerb | null, recordAsVerb: ControlVerb = verb,
  step: { stepOid: string; stepName: string } | null = null,
): Promise<void> {
  await db.transaction(async (tx) => {
    let actorCols;
    if (actor.kind === 'user') {
      const [u] = await tx.select({ loginName: appUser.loginName, displayName: appUser.displayName })
        .from(appUser).where(eq(appUser.id, actor.userId));
      if (!u) throw new DaoError('USER_NOT_FOUND');
      actorCols = { actorKind: 'user', actorUserId: actor.userId, actorLoginName: u.loginName, actorDisplayName: u.displayName, actorLabel: null, actorInstanceId: null };
    } else {
      actorCols = {
        actorKind: actor.kind, actorUserId: null, actorLoginName: null, actorDisplayName: null, actorLabel: actor.label,
        actorInstanceId: actor.kind === 'remote' ? actor.instanceId : null,
      };
    }
    const [cur] = await tx.select({ status: workflowInstance.status }).from(workflowInstance)
      .where(eq(workflowInstance.id, instanceId)).for('update');
    if (!cur) throw new DaoError('RUNTIME_NOT_FOUND');
    const rule = rules.find((r) => r.from.includes(cur.status));
    if (!rule) throw new DaoError('RUNTIME_INVALID_STATE', `cannot ${label} from ${cur.status}`);
    await tx.update(workflowInstance)
      .set({ status: rule.to, updatedAt: new Date(), ...(skip ? { cleanupSkip: skip } : {}) })
      .where(eq(workflowInstance.id, instanceId));
    await tx.insert(runtimeControlEvent).values({
      workflowInstanceId: instanceId, verb: recordAsVerb, effect: rule.effect, fromStatus: cur.status, toStatus: rule.to, ...actorCols,
      stepOid: step?.stepOid ?? null, stepName: step?.stepName ?? null,
    });
  });
}

/** `opts`: the step the operator pressed Stop on (Back/Stop spec 2026-11-11), recorded on the event. */
export const requestStop = (db: Db, id: string, actor: ControlActor, opts?: { stepOid: string; stepName: string }) =>
  controlTransition(db, id, 'stop', 'stop', [
    { from: ['running', 'paused', 'pausing'], to: 'stopping', effect: 'request' },
  ], actor, null, undefined, opts ?? null);

/** `recordAsVerb`: the verb the audit row records when it differs from the transition — a remote
 *  Stop of a queued runtime is carried out as an Abort, but the record shows the Stop that was
 *  sent (U8). Same transaction as the status change. */
export const requestAbort = (db: Db, id: string, actor: ControlActor, opts: { recordAsVerb?: ControlVerb } = {}) =>
  controlTransition(db, id, 'abort', 'abort', [
    { from: ['queued', 'running', 'pausing', 'paused', 'resuming', 'stopping'], to: 'aborting', effect: 'request' },
    { from: ['stopping_cleanup'], to: 'aborting', effect: 'escalate' },
  ], actor, null, opts.recordAsVerb);

/** The only way to skip a running cleanup; a second plain Stop/Abort is never a skip (U7). */
export const requestSkipCleanup = (db: Db, id: string, kind: ControlVerb, actor: ControlActor) =>
  controlTransition(db, id, kind, 'skip cleanup', [
    kind === 'stop'
      ? { from: ['stopping', 'stopping_cleanup'], to: 'stopping', effect: 'skip_cleanup' }
      : { from: ['aborting', 'aborting_cleanup'], to: 'aborting', effect: 'skip_cleanup' },
  ], actor, kind);
