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

// Carrying out a Resume decision (spec 2026-11-08 §7.3): the controls write it down and the tick
// creates the runs, one transaction per chain or slot. Held chains go first, oldest first, then
// missed slots, oldest first.
//
// Locks: an item run, then the Runtime, then its workflows, the order chain.ts uses. The controls
// take the Runtime and then rows that are `held` or `start_requested`, so the Runtime is always
// taken here with SKIP LOCKED: a control in progress makes this wait for the next tick, and neither
// side ever waits on the other in a circle.

import { and, asc, eq, gte, isNotNull, lte, notExists, notInArray, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { Schema } from '../db/client.js';
import {
  runtimeSchedule, runtimeScheduleItem, scheduleItemRun, scheduleOccurrence,
  type RuntimeSchedule, type ScheduleItemRun, type ScheduleOccurrence,
} from '../db/schema/index.js';
import { pgViolates } from '../dao/errors.js';
import { chainContext, startChainItem } from './chain.js';
import { appendScheduleEvent } from './events.js';
import { SLOT_ALREADY_RECORDED, SYSTEM, fireOneSlot, lockItemWorkflows, logOnce, reasonOf } from './fire.js';
import { nextOccurrence, slotsBetween, type Recurrence, type Slot } from './recurrence.js';

type Db = PgDatabase<any, Schema>;

const MAX_CHAINS_PER_CALL = 50;
const MAX_SLOTS_PER_CALL = 20;
/** Units that throw do not use up the limits above, so this is what bounds a tick when many are broken. */
const MAX_ATTEMPTS_PER_CALL = 100;
const SLOTS_PER_LOOK = 100;
const NO_CATCHUP = { catchupMode: null, catchupCursor: null, catchupTo: null };

/** The times in this range that already have an occurrence, in milliseconds. */
export async function recordedSlotTimes(db: Db, runtimeId: string, from: Date, to: Date): Promise<Set<number>> {
  const rows = await db.select({ at: scheduleOccurrence.scheduledAt }).from(scheduleOccurrence).where(and(
    eq(scheduleOccurrence.runtimeScheduleId, runtimeId),
    gte(scheduleOccurrence.scheduledAt, from),
    lte(scheduleOccurrence.scheduledAt, to),
  ));
  return new Set(rows.map((r) => r.at.getTime()));
}

/** Starts one chain the Resume asked for. The caller holds its run row and the Runtime's. */
async function startRequestedChain(
  tx: Db, run: ScheduleItemRun, occurrence: ScheduleOccurrence, runtime: RuntimeSchedule,
): Promise<void> {
  // Read now the Runtime is locked: a Disable takes that lock too, so one committed is seen here.
  const [item] = await tx.select().from(runtimeScheduleItem).where(eq(runtimeScheduleItem.id, run.itemId));
  // §7.2: a disabled item does not start, whenever it was disabled.
  if (item!.disabled) {
    await tx.update(scheduleItemRun).set({ status: 'skipped_disabled' }).where(eq(scheduleItemRun.id, run.id));
    return;
  }
  const [parent] = run.parentRunId
    ? await tx.select().from(scheduleItemRun).where(eq(scheduleItemRun.id, run.parentRunId))
    : [];
  if (!parent) {
    await tx.update(scheduleItemRun).set({ status: 'failed_to_start', detail: 'The run that triggered this chain is gone' })
      .where(eq(scheduleItemRun.id, run.id));
    return;
  }
  await lockItemWorkflows(tx, item!.workflowId ? [item!.workflowId] : []);
  await startChainItem(tx, parent, item!, chainContext(parent, runtime, occurrence));
}

/**
 * The `start_requested` rows, oldest first, at most 50 per call. One whose Runtime is busy or no
 * longer active stays as it is for the next Resume, Pause or Cancel to settle. One that throws
 * stays too, is logged, and is tried again on the next tick. Returns the chains settled.
 */
async function startRequestedChains(db: Db): Promise<number> {
  const passedRuns: string[] = [];
  const passedRuntimes: string[] = [];
  let settled = 0;
  for (let attempts = 0; settled < MAX_CHAINS_PER_CALL && attempts < MAX_ATTEMPTS_PER_CALL; attempts++) {
    const seen: { runId?: string; runtimeId?: string } = {};
    try {
      const outcome = await db.transaction(async (t): Promise<'none' | 'settled' | 'passed'> => {
        const tx = t as unknown as Db;
        const [found] = await tx.select({ run: scheduleItemRun, occurrence: scheduleOccurrence })
          .from(scheduleItemRun)
          .innerJoin(scheduleOccurrence, eq(scheduleOccurrence.id, scheduleItemRun.occurrenceId))
          .innerJoin(runtimeScheduleItem, eq(runtimeScheduleItem.id, scheduleItemRun.itemId))
          .where(and(
            eq(scheduleItemRun.status, 'start_requested'),
            passedRuns.length ? notInArray(scheduleItemRun.id, passedRuns) : undefined,
            passedRuntimes.length ? notInArray(scheduleOccurrence.runtimeScheduleId, passedRuntimes) : undefined,
          ))
          .orderBy(asc(scheduleItemRun.createdAt), asc(runtimeScheduleItem.position), asc(scheduleItemRun.id)).limit(1)
          .for('update', { of: scheduleItemRun, skipLocked: true });
        if (!found) return 'none';
        seen.runId = found.run.id;
        seen.runtimeId = found.occurrence.runtimeScheduleId;

        const [runtime] = await tx.select().from(runtimeSchedule)
          .where(eq(runtimeSchedule.id, found.occurrence.runtimeScheduleId))
          .for('update', { skipLocked: true });
        if (runtime?.status !== 'active') return 'passed';

        await startRequestedChain(tx, found.run, found.occurrence, runtime);
        return 'settled';
      });
      if (outcome === 'none') break;
      if (outcome === 'settled') settled++;
      else passedRuntimes.push(seen.runtimeId!);
    } catch (err) {
      // Nothing seen yet means the query for one failed, which is not this row's fault.
      if (!seen.runId) throw err;
      passedRuns.push(seen.runId);
      logOnce(seen.runtimeId!, reasonOf(err));
    }
  }
  return settled;
}

/** The first slot from the cursor to the window's end with no occurrence, or null when none is left. */
async function nextOpenSlot(tx: Db, row: RuntimeSchedule): Promise<Slot | null> {
  if (!row.catchupCursor || !row.catchupTo) return null;
  const recurrence = row.recurrence as Recurrence;
  let from = row.catchupCursor;
  for (;;) {
    const { slots } = slotsBetween(recurrence, row.timeZone, from, row.catchupTo, SLOTS_PER_LOOK);
    const last = slots.at(-1);
    if (!last) return null;
    const recorded = await recordedSlotTimes(tx, row.id, from, last.at);
    const open = slots.find((s) => !recorded.has(s.at.getTime()));
    if (open) return open;
    from = new Date(last.at.getTime() + 1);
  }
}

/** What follows a handled slot: the cursor moves to the next one, or the catch-up is over. */
async function moveCursorPast(tx: Db, row: RuntimeSchedule, slot: Slot): Promise<void> {
  const next = nextOccurrence(row.recurrence as Recurrence, row.timeZone, slot.at);
  if (next && next.at <= row.catchupTo!) {
    await tx.update(runtimeSchedule).set({ catchupCursor: next.at }).where(eq(runtimeSchedule.id, row.id));
  } else {
    await finishCatchup(tx, row);
  }
}

async function finishCatchup(tx: Db, row: RuntimeSchedule): Promise<void> {
  await tx.update(runtimeSchedule).set(NO_CATCHUP).where(eq(runtimeSchedule.id, row.id));
  await appendScheduleEvent(tx, {
    runtimeScheduleId: row.id, action: 'catchup_finished', actor: SYSTEM, detail: { mode: row.catchupMode },
  });
}

/** The slot has an occurrence after all, so firing it can never succeed. False if the row was busy. */
async function skipRecordedSlot(db: Db, seen: RuntimeSchedule, slot: Slot): Promise<boolean> {
  return db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const [row] = await tx.select().from(runtimeSchedule)
      .where(eq(runtimeSchedule.id, seen.id)).for('update', { skipLocked: true });
    if (row?.status !== 'active' || row.catchupCursor?.getTime() !== seen.catchupCursor?.getTime()) return false;
    await moveCursorPast(tx, row, slot);
    await appendScheduleEvent(tx, {
      runtimeScheduleId: row.id, action: 'slot_already_recorded', actor: SYSTEM,
      detail: { number: slot.number, scheduledAt: slot.at.toISOString() },
    });
    return true;
  });
}

/**
 * Missed slots, oldest first, at most 20 per call and one per transaction. A Runtime's slots wait
 * until its chains have all started (§7.3). A Runtime that throws is logged, and does not use up
 * the 20. Returns the slots fired.
 */
async function fireCatchupSlots(db: Db): Promise<number> {
  const tried: string[] = [];
  let fired = 0;
  for (let attempts = 0; fired < MAX_SLOTS_PER_CALL && attempts < MAX_ATTEMPTS_PER_CALL; attempts++) {
    const seen: { row?: RuntimeSchedule; slot?: Slot } = {};
    try {
      const outcome = await db.transaction(async (t): Promise<'none' | 'fired' | 'cleared'> => {
        const tx = t as unknown as Db;
        const chainsWaiting = tx.select({ one: sql`1` }).from(scheduleItemRun)
          .innerJoin(scheduleOccurrence, eq(scheduleOccurrence.id, scheduleItemRun.occurrenceId))
          .where(and(
            eq(scheduleOccurrence.runtimeScheduleId, runtimeSchedule.id),
            eq(scheduleItemRun.status, 'start_requested'),
          ));
        // As in fireDueSlots, the status check here is re-evaluated on the row version locked.
        const [row] = await tx.select().from(runtimeSchedule).where(and(
          eq(runtimeSchedule.status, 'active'),
          isNotNull(runtimeSchedule.catchupMode),
          notExists(chainsWaiting),
          tried.length ? notInArray(runtimeSchedule.id, tried) : undefined,
        )).orderBy(asc(runtimeSchedule.catchupCursor), asc(runtimeSchedule.id)).limit(1)
          .for('update', { skipLocked: true });
        if (!row) return 'none';
        seen.row = row;

        const slot = await nextOpenSlot(tx, row);
        if (!slot) {
          await finishCatchup(tx, row);
          return 'cleared';
        }
        seen.slot = slot;
        await fireOneSlot(tx, row, slot, 'resume');
        await moveCursorPast(tx, row, slot);
        return 'fired';
      });
      if (outcome === 'none') break;
      if (outcome === 'fired') fired++;
    } catch (err) {
      // No row yet means the query for one failed, which is not this Runtime's fault.
      if (!seen.row) throw err;
      try {
        const moved = seen.slot && pgViolates(err, SLOT_ALREADY_RECORDED) && await skipRecordedSlot(db, seen.row, seen.slot);
        if (!moved) {
          tried.push(seen.row.id);
          logOnce(seen.row.id, reasonOf(err));
        }
      } catch (again) {
        tried.push(seen.row.id);
        logOnce(seen.row.id, reasonOf(again));
      }
    }
  }
  return fired;
}

/** One tick's share of the Resume decisions. Returns the chains settled plus the slots fired. */
export async function runCatchup(db: Db, _now: Date): Promise<number> {
  const chains = await startRequestedChains(db);
  const slots = await fireCatchupSlots(db);
  return chains + slots;
}
