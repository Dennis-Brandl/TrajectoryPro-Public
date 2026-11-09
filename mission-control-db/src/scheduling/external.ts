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

// What the external scheduling interface does beyond the shared DAOs (spec 2026-11-08 §8.3, §8.4).

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { Schema } from '../db/client.js';
import {
  masterSchedule, runtimeSchedule, runtimeScheduleEvent, scheduleItemRun, scheduleOccurrence,
  type ScheduleItemRunStatus,
} from '../db/schema/index.js';
import { DaoError, pgViolates } from '../dao/errors.js';
import { cancelRuntimeSchedule } from './controls.js';
import { enableMasterSchedule } from './enable.js';
import type { ScheduleActor } from './events.js';
import { getMasterSchedule, upsertMasterScheduleByKey, type MasterScheduleView } from './master-dao.js';
import { listOccurrences, loadRuntimeScheduleView, type RuntimeScheduleView } from './runtime-dao.js';

type Db = PgDatabase<any, Schema>;

const REPLACED_REASON = 'Replaced by re-send';

export type ReplacedRuntimeSchedule = {
  id: string;
  label: string;
  status: 'cancelled';
  /** Runs of the old Runtime still going. They carry on, and their chains will not fire (§9.7). */
  runsStillGoing: number;
  /** Chained items that were waiting to start, and now will not. */
  chainsCancelled: number;
};

export type SendOutcome =
  /** Saved only: `enable` was not asked for. */
  | 'saved'
  /** A new Runtime was created. */
  | 'enabled'
  /** The key's latest Runtime is live and froze this same content: a retry. */
  | 'already_live'
  /** The key's latest Runtime ended and froze this same content: it is not revived. */
  | 'already_ended';

export type SendResult = {
  master: MasterScheduleView;
  created: boolean;
  changed: boolean;
  outcome: SendOutcome;
  runtime: RuntimeScheduleView | null;
  warnings: string[];
  replaced: ReplacedRuntimeSchedule | null;
};

async function saveByKey(db: Db, workCenterId: string, key: string, body: unknown, actor: ScheduleActor) {
  try {
    return await upsertMasterScheduleByKey(db, workCenterId, key, body, actor);
  } catch (err) {
    // Two first sends of one key at once. Either unique index may be the one that catches the second
    // insert, and by now the first has committed, so this attempt finds it and updates. A name truly
    // used by another Master fails the same way again.
    const collided = pgViolates(err, 'master_schedule_wc_external_key_uq')
      || (err instanceof DaoError && err.code === 'MASTER_SCHEDULE_NAME_CONFLICT');
    if (!collided) throw err;
    return upsertMasterScheduleByKey(db, workCenterId, key, body, actor);
  }
}

/** The warnings Enable gave this Runtime, so that a retry answers as the first attempt did. */
async function enableWarnings(db: Db, runtimeId: string): Promise<string[]> {
  const [ev] = await db.select({ detail: runtimeScheduleEvent.detail }).from(runtimeScheduleEvent)
    .where(and(eq(runtimeScheduleEvent.runtimeScheduleId, runtimeId), eq(runtimeScheduleEvent.action, 'enabled')))
    .orderBy(desc(runtimeScheduleEvent.at)).limit(1);
  return (ev?.detail as { warnings?: string[] } | null)?.warnings ?? [];
}

async function countRuns(db: Db, runtimeId: string, statuses: ScheduleItemRunStatus[]): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(scheduleItemRun)
    .innerJoin(scheduleOccurrence, eq(scheduleOccurrence.id, scheduleItemRun.occurrenceId))
    .where(and(eq(scheduleOccurrence.runtimeScheduleId, runtimeId), inArray(scheduleItemRun.status, statuses)));
  return row?.n ?? 0;
}

/**
 * §8.3: saves the body, then decides the Enable part by comparing what was sent with what the key's
 * latest Runtime froze, so the answer depends on neither the attempt, nor edits in between, nor a
 * Master deleted and recreated. The save commits on its own: a failed Enable leaves it saved. A
 * replaceActive cancel and its Enable share one transaction: when the Enable fails, the old Runtime
 * stays on.
 */
export async function sendMasterSchedule(
  db: Db, workCenterId: string, key: string, body: unknown,
  options: { enable: boolean; replaceActive: boolean }, actor: ScheduleActor, now: Date,
): Promise<SendResult> {
  const saved = await saveByKey(db, workCenterId, key, body, actor);
  const { created, changed } = saved;
  if (!options.enable) {
    return { master: saved.master, created, changed, outcome: 'saved', runtime: null, warnings: [], replaced: null };
  }

  const decided = await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    // Lock order: Master, then Runtime, then whatever Enable locks. The engine's fire and chain
    // transactions never lock a Master, and lock a Runtime before the workflow rows too.
    const [locked] = await tx.select({ id: masterSchedule.id }).from(masterSchedule)
      .where(eq(masterSchedule.id, saved.master.id)).for('update');
    if (!locked) throw new DaoError('MASTER_SCHEDULE_NOT_FOUND');
    const [latest] = await tx.select().from(runtimeSchedule)
      .where(and(eq(runtimeSchedule.workCenterId, workCenterId), eq(runtimeSchedule.externalKey, key)))
      .orderBy(desc(runtimeSchedule.runtimeNumber)).limit(1).for('update');

    const enableNew = async (replaced: ReplacedRuntimeSchedule | null) => {
      const { runtime, warnings, master } = await enableMasterSchedule(tx, saved.master.id, actor, now);
      return { outcome: 'enabled' as const, master, runtime, warnings, replaced };
    };
    if (!latest) return enableNew(null);

    const live = latest.status === 'active' || latest.status === 'paused';
    if (latest.definitionHash === saved.definitionHash) {
      // Both read here, under the lock: a delete racing this answer waits, and cannot turn it into an error.
      const [master, runtime] = [await getMasterSchedule(tx, saved.master.id), await loadRuntimeScheduleView(tx, latest.id)];
      if (!master || !runtime) throw new DaoError('MASTER_SCHEDULE_NOT_FOUND');
      return {
        outcome: live ? 'already_live' as const : 'already_ended' as const,
        master, runtime, warnings: await enableWarnings(tx, latest.id), replaced: null,
      };
    }
    if (!live) return enableNew(null);
    if (!options.replaceActive) {
      throw new DaoError(
        'RUNTIME_ACTIVE',
        `${latest.label} is running different content for this schedule. Send again with replaceActive=true to cancel it and enable this one.`,
      );
    }
    const chainsCancelled = await countRuns(tx, latest.id, ['held', 'start_requested']);
    await cancelRuntimeSchedule(tx, latest.id, REPLACED_REASON, actor, now);
    const runsStillGoing = await countRuns(tx, latest.id, ['started']);
    return enableNew({ id: latest.id, label: latest.label, status: 'cancelled', runsStillGoing, chainsCancelled });
  });

  return { ...decided, created, changed };
}

export type ExternalRunView = {
  id: string;
  itemId: string;
  workflowName: string | null;
  parentRunId: string | null;
  runtimeLabel: string | null;
  status: ScheduleItemRunStatus;
  /** How the run ended: completed, stopped, aborted, errored. Null until it has ended. */
  ending: string | null;
  finishedAt: Date | null;
  detail: string | null;
  acknowledgedAt: Date | null;
  /** Only on a run that has ended. */
  outputs?: Record<string, string>;
};
export type ExternalOccurrenceView = {
  id: string;
  number: number;
  scheduledAt: Date;
  firedAt: Date | null;
  origin: string;
  runs: ExternalRunView[];
};

/** The occurrence page with each run's ending and, from trigger_values, its outputs. */
export async function listOccurrencesWithEndings(
  db: Db, runtimeId: string, page: { limit: number; offset: number },
): Promise<{ rows: ExternalOccurrenceView[]; total: number }> {
  const { rows, total } = await listOccurrences(db, runtimeId, page);
  const runIds = rows.flatMap((o) => o.runs.map((r) => r.id));
  const extras = new Map(runIds.length === 0 ? [] : (await db.select({
    id: scheduleItemRun.id, triggerValues: scheduleItemRun.triggerValues, finishedAt: scheduleItemRun.finishedAt,
  }).from(scheduleItemRun).where(inArray(scheduleItemRun.id, runIds))).map((r) => [r.id, r]));
  return {
    total,
    rows: rows.map(({ runs, ...occurrence }) => ({
      ...occurrence,
      runs: runs.map((r) => {
        const extra = extras.get(r.id);
        const view: ExternalRunView = {
          id: r.id, itemId: r.itemId, workflowName: r.itemName, parentRunId: r.parentRunId,
          runtimeLabel: r.runtimeLabel, status: r.status, ending: r.finalState, finishedAt: extra?.finishedAt ?? null,
          detail: r.detail, acknowledgedAt: r.acknowledgedAt,
        };
        if (r.status === 'finished') {
          view.outputs = (extra?.triggerValues as { outputs?: Record<string, string> } | null)?.outputs ?? {};
        }
        return view;
      }),
    })),
  };
}
