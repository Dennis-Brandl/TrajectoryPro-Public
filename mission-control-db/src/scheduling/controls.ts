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

// The controls on a Runtime Schedule (spec 2026-11-08 §7.2, §7.3). They only write state: status,
// catch-up columns, row statuses, and an event. The tick creates the runs (catchup.ts).
//
// Every control takes the Runtime row FOR UPDATE first, which serializes it with the chain and fire
// transactions. Under that lock a control must not touch a `started` item run: chain.ts locks an
// item run and then the Runtime, so the reverse order here would deadlock.

import { and, asc, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { alias, type PgDatabase } from 'drizzle-orm/pg-core';
import type { Schema } from '../db/client.js';
import {
  runtimeSchedule, runtimeScheduleEvent, runtimeScheduleItem, scheduleItemRun, scheduleOccurrence, type RuntimeSchedule,
} from '../db/schema/index.js';
import { DaoError } from '../dao/errors.js';
import { recordedSlotTimes } from './catchup.js';
import { appendScheduleEvent, type ScheduleActor } from './events.js';
import { nextOccurrence, previousOccurrence, slotsBetween, type Recurrence } from './recurrence.js';

type Db = PgDatabase<any, Schema>;

export type ResumeChoice = {
  missed?: 'all' | 'latest' | 'skip';
  heldChains?: 'start' | 'skip' | { start: string[]; skip: string[] };
  /** The count of missed starts the person was shown. When it differs from the count now, nothing is changed. */
  expectedMissedCount?: number;
};

export type HeldChainView = {
  id: string;
  itemId: string;
  name: string;
  occurrenceNumber: number;
  scheduledAt: Date;
  fromRunLabel: string | null;
  fromFinalState: string | null;
  fromFinishedAt: Date | null;
  disabled: boolean;
};

export type ResumePreview = {
  missedCount: number;
  missedMore: boolean;
  missedFirst: Date | null;
  missedLast: Date | null;
  startAllAllowed: boolean;
  held: HeldChainView[];
  /** When it was paused and by whom (the latest `paused` event's actor), for the dialog's first line. */
  pausedAt: Date | null;
  pausedBy: string | null;
};

/** §7.3: "Start all" goes up to this many. Past it the count stops, so the answer stays cheap. */
const START_ALL_LIMIT = 500;
const SLOTS_PER_LOOK = START_ALL_LIMIT + 1;
/** A window this long with too few undecided slots to stop at is reported as over the limit. */
const MAX_LOOKS = 20;
const RECORDED_PER_LOOK = 1000;

async function lockRuntime(tx: Db, id: string): Promise<RuntimeSchedule> {
  const [row] = await tx.select().from(runtimeSchedule).where(eq(runtimeSchedule.id, id)).for('update');
  if (!row) throw new DaoError('RUNTIME_SCHEDULE_NOT_FOUND', 'Runtime Schedule not found');
  return row;
}

const wrongState = (row: RuntimeSchedule, control: string) =>
  new DaoError('RUNTIME_SCHEDULE_STATE', `${row.label} is ${row.status}: this schedule changed, so ${control} does not apply`);

const earliest = (a: Date | null, b: Date | null) => (a && b ? (a < b ? a : b) : a ?? b);
const latest = (a: Date | null, b: Date | null) => (a && b ? (a > b ? a : b) : a ?? b);

const runtimeOccurrences = (tx: Db, id: string) => inArray(
  scheduleItemRun.occurrenceId,
  tx.select({ id: scheduleOccurrence.id }).from(scheduleOccurrence).where(eq(scheduleOccurrence.runtimeScheduleId, id)),
);

// ---------------------------------------------------------------------------------- the missed window

type MissedWindow = { count: number; more: boolean; first: Date | null; last: Date | null };
const NOTHING_MISSED: MissedWindow = { count: 0, more: false, first: null, last: null };

/** The last slot at or before `now` with no occurrence, walking back from the end of the window. */
async function lastUndecidedSlot(db: Db, row: RuntimeSchedule, from: Date, now: Date): Promise<Date | null> {
  const recurrence = row.recurrence as Recurrence;
  let slot = previousOccurrence(recurrence, row.timeZone, new Date(now.getTime() + 1));
  while (slot && slot.at >= from) {
    const recorded = await db.select({ at: scheduleOccurrence.scheduledAt }).from(scheduleOccurrence).where(and(
      eq(scheduleOccurrence.runtimeScheduleId, row.id),
      gte(scheduleOccurrence.scheduledAt, from),
      lte(scheduleOccurrence.scheduledAt, slot.at),
    )).orderBy(desc(scheduleOccurrence.scheduledAt)).limit(RECORDED_PER_LOOK);
    const times = new Set(recorded.map((r) => r.at.getTime()));
    const oldest = recorded.at(-1)?.at.getTime() ?? Number.POSITIVE_INFINITY;
    while (slot && times.has(slot.at.getTime())) slot = previousOccurrence(recurrence, row.timeZone, slot.at);
    if (!slot || slot.at < from) return null;
    // Below what this look fetched, the slot may yet be recorded: look again from there.
    if (recorded.length < RECORDED_PER_LOOK || slot.at.getTime() >= oldest) return slot.at;
  }
  return null;
}

/**
 * §6.4, §7.3: the slots from missed_from (or else next_fire_at, when paused) up to now that have no
 * occurrence. An active Runtime has none unless an outage left a window. It stops at the first
 * undecided slot past the limit, so a long pause costs one look at the recurrence.
 */
async function missedWindow(db: Db, row: RuntimeSchedule, now: Date): Promise<MissedWindow> {
  const from = row.status === 'paused' ? row.missedFrom ?? row.nextFireAt : row.missedFrom;
  if (!from) return NOTHING_MISSED;
  const recurrence = row.recurrence as Recurrence;

  let count = 0;
  let first: Date | null = null;
  let last: Date | null = null;
  let cursor = from;
  let more = true;
  for (let look = 0; look < MAX_LOOKS && more; look++) {
    const { slots, truncated } = slotsBetween(recurrence, row.timeZone, cursor, now, SLOTS_PER_LOOK);
    const end = slots.at(-1)?.at;
    const recorded = end ? await recordedSlotTimes(db, row.id, cursor, end) : new Set<number>();
    for (const slot of slots) {
      if (recorded.has(slot.at.getTime())) continue;
      if (++count > START_ALL_LIMIT) break;
      first ??= slot.at;
      last = slot.at;
    }
    if (count > START_ALL_LIMIT) break;
    more = truncated;
    if (end) cursor = new Date(end.getTime() + 1);
  }
  if (!more) return { count, more: false, first, last };

  const lastSlot = await lastUndecidedSlot(db, row, from, now);
  if (!lastSlot) return NOTHING_MISSED;
  return { count: START_ALL_LIMIT, more: true, first: first ?? lastSlot, last: lastSlot };
}

async function heldChains(db: Db, id: string): Promise<HeldChainView[]> {
  const parent = alias(scheduleItemRun, 'parent_run');
  const rows = await db.select({
    id: scheduleItemRun.id, itemId: scheduleItemRun.itemId, name: runtimeScheduleItem.masterName,
    occurrenceNumber: scheduleOccurrence.number, scheduledAt: scheduleOccurrence.scheduledAt,
    fromRunLabel: parent.runtimeLabel, fromFinalState: parent.finalState, fromFinishedAt: parent.finishedAt,
    disabled: runtimeScheduleItem.disabled,
  }).from(scheduleItemRun)
    .innerJoin(scheduleOccurrence, eq(scheduleOccurrence.id, scheduleItemRun.occurrenceId))
    .innerJoin(runtimeScheduleItem, eq(runtimeScheduleItem.id, scheduleItemRun.itemId))
    .leftJoin(parent, eq(parent.id, scheduleItemRun.parentRunId))
    .where(and(eq(scheduleOccurrence.runtimeScheduleId, id), eq(scheduleItemRun.status, 'held')))
    .orderBy(asc(scheduleItemRun.createdAt), asc(runtimeScheduleItem.position), asc(scheduleItemRun.id));
  return rows;
}

async function pausedByName(db: Db, id: string): Promise<string | null> {
  const [ev] = await db.select({ name: runtimeScheduleEvent.actorName }).from(runtimeScheduleEvent)
    .where(and(eq(runtimeScheduleEvent.runtimeScheduleId, id), eq(runtimeScheduleEvent.action, 'paused')))
    .orderBy(desc(runtimeScheduleEvent.at), desc(runtimeScheduleEvent.id)).limit(1);
  return ev?.name ?? null;
}

/** What the Resume dialog shows. An active Runtime with no window waiting simply has nothing to show. */
export async function getResumePreview(db: Db, id: string, now: Date): Promise<ResumePreview> {
  const [row] = await db.select().from(runtimeSchedule).where(eq(runtimeSchedule.id, id));
  if (!row) throw new DaoError('RUNTIME_SCHEDULE_NOT_FOUND', 'Runtime Schedule not found');
  if (row.status !== 'active' && row.status !== 'paused') throw wrongState(row, 'Resume');
  const window = await missedWindow(db, row, now);
  return {
    missedCount: window.count, missedMore: window.more, missedFirst: window.first, missedLast: window.last,
    startAllAllowed: !window.more, held: await heldChains(db, id),
    pausedAt: row.pausedAt, pausedBy: row.status === 'paused' ? await pausedByName(db, id) : null,
  };
}

// ------------------------------------------------------------------------------------------- pause

export async function pauseRuntimeSchedule(db: Db, id: string, actor: ScheduleActor, now: Date): Promise<void> {
  await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const row = await lockRuntime(tx, id);
    if (row.status !== 'active') throw wrongState(row, 'Pause');

    // §7.3: slots a catch-up has not started go back to the undecided window, and merge with any
    // outage window. next_fire_at stays where it was (§5.4).
    const returnedFrom = row.catchupMode ? row.catchupCursor : null;
    await tx.update(runtimeSchedule).set({
      status: 'paused', pausedAt: now,
      missedFrom: earliest(row.missedFrom, returnedFrom),
      missedTo: latest(row.missedTo, returnedFrom ? row.catchupTo : null),
      catchupMode: null, catchupCursor: null, catchupTo: null,
    }).where(eq(runtimeSchedule.id, id));
    const requested = await tx.update(scheduleItemRun).set({ status: 'held' })
      .where(and(eq(scheduleItemRun.status, 'start_requested'), runtimeOccurrences(tx, id)))
      .returning({ id: scheduleItemRun.id });

    await appendScheduleEvent(tx, {
      runtimeScheduleId: id, action: 'paused', actor,
      detail: { catchupReturnedFrom: returnedFrom?.toISOString() ?? null, chainsHeldAgain: requested.length },
    });
  });
}

// ------------------------------------------------------------------------------------------ resume

/**
 * The catch-up columns after a choice. A catch-up already running only ever coexists with an outage
 * window. Only `all` can merge with it: a declined slot leaves no row, so a range reaching over it,
 * or a Pause returning that range to the window, would start it after all.
 */
function catchupAfter(
  row: RuntimeSchedule, missed: ResumeChoice['missed'], window: MissedWindow, now: Date,
): Pick<RuntimeSchedule, 'catchupMode' | 'catchupCursor' | 'catchupTo'> {
  if (missed && missed !== 'all' && row.catchupMode) {
    throw new DaoError(
      'RUNTIME_SCHEDULE_STATE',
      `${row.label} is still catching up, so these starts cannot be declined yet. Choose all, or try again when it has finished.`,
    );
  }
  if (missed === 'all') {
    // Since a running catch-up's window closed, slots have fired or are in this window, and none
    // can have been declined (above), so one range covers both.
    return { catchupMode: 'all', catchupCursor: earliest(row.catchupCursor, window.first), catchupTo: now };
  }
  if (missed === 'latest') return { catchupMode: 'latest', catchupCursor: window.last, catchupTo: window.last };
  return { catchupMode: row.catchupMode, catchupCursor: row.catchupCursor, catchupTo: row.catchupTo };
}

/** Applies the choice to the held rows. A disabled item's row is skipped_disabled whatever was asked. */
async function settleHeldRows(
  tx: Db, row: RuntimeSchedule, choice: NonNullable<ResumeChoice['heldChains']>,
): Promise<{ started: number; skipped: number }> {
  const held = await heldChains(tx, row.id);
  const named = typeof choice === 'object' ? choice : { start: [], skip: [] };
  if (typeof choice === 'object') {
    const heldIds = new Set(held.map((h) => h.id));
    const all = [...named.start, ...named.skip];
    if (new Set(all).size !== all.length || !all.every((rowId) => heldIds.has(rowId))) {
      throw new DaoError('RUNTIME_SCHEDULE_STATE', 'The chains waiting have changed: review them and try again');
    }
  }
  const skipAsked = (rowId: string) => choice === 'skip' || named.skip.includes(rowId);
  const groups = { start_requested: [] as string[], skipped_on_resume: [] as string[], skipped_disabled: [] as string[] };
  for (const h of held) {
    const status = h.disabled ? 'skipped_disabled' : skipAsked(h.id) ? 'skipped_on_resume' : 'start_requested';
    groups[status].push(h.id);
  }
  for (const [status, ids] of Object.entries(groups)) {
    if (ids.length) await tx.update(scheduleItemRun).set({ status }).where(inArray(scheduleItemRun.id, ids));
  }
  return { started: groups.start_requested.length, skipped: groups.skipped_on_resume.length + groups.skipped_disabled.length };
}

/** Writes the decision down; the tick carries it out. Also resolves an outage window on an active Runtime (§6.4). */
export async function resumeRuntimeSchedule(
  db: Db, id: string, choice: ResumeChoice, actor: ScheduleActor, now: Date,
): Promise<{ startedSlots: number; startedChains: number; skippedSlots: number; skippedChains: number; missedMore: boolean }> {
  return db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const row = await lockRuntime(tx, id);
    const windowWaiting = row.status === 'active' && row.missedFrom !== null;
    if (row.status !== 'paused' && !windowWaiting) throw wrongState(row, 'Resume');

    const window = await missedWindow(tx, row, now);
    // The person chose from a count they were shown; a paused schedule keeps missing slots, so the
    // count may have grown while the dialog was open. Decide nothing on a number they did not see.
    if (choice.expectedMissedCount !== undefined && choice.expectedMissedCount !== window.count) {
      throw new DaoError(
        'RESUME_CHOICE_REQUIRED',
        `The number of missed starts changed: ${window.more ? `more than ${START_ALL_LIMIT}` : window.count} now.`,
      );
    }
    const missed = window.count > 0 ? choice.missed : undefined;
    if (window.count > 0 && (!missed || !['all', 'latest', 'skip'].includes(missed))) {
      throw new DaoError('RESUME_CHOICE_REQUIRED', 'Scheduled starts were missed: choose all, latest or skip');
    }
    if (missed === 'all' && window.more) {
      throw new DaoError(
        'RESUME_CHOICE_REQUIRED',
        `More than ${START_ALL_LIMIT} scheduled starts were missed, which is too many to start all: choose latest or skip`,
      );
    }

    const catchup = catchupAfter(row, missed, window, now);
    const heldChoice = choice.heldChains ?? 'start';
    const chains = await settleHeldRows(tx, row, heldChoice);
    const next = nextOccurrence(row.recurrence as Recurrence, row.timeZone, now);
    await tx.update(runtimeSchedule).set({
      status: 'active', pausedAt: null, missedFrom: null, missedTo: null, nextFireAt: next?.at ?? null, ...catchup,
    }).where(eq(runtimeSchedule.id, id));

    const startedSlots = missed === 'all' ? window.count : missed === 'latest' ? 1 : 0;
    const counts = {
      startedSlots, startedChains: chains.started,
      // Counting stops at the limit: with missedMore, more than this many were skipped.
      skippedSlots: window.count - startedSlots, skippedChains: chains.skipped, missedMore: window.more,
    };
    await appendScheduleEvent(tx, {
      runtimeScheduleId: id, action: 'resumed', actor,
      detail: {
        missed: missed ?? null, heldChains: heldChoice, missedCount: window.count,
        window: window.first ? { from: window.first.toISOString(), to: now.toISOString() } : null,
        ...counts,
      },
    });
    return counts;
  });
}

// ------------------------------------------------------------------------------------------ cancel

export async function cancelRuntimeSchedule(
  db: Db, id: string, reason: string, actor: ScheduleActor, now: Date,
): Promise<void> {
  const why = reason.trim();
  if (!why) throw new DaoError('CONFIRMATION_REQUIRED', 'Cancel needs a reason');
  await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const row = await lockRuntime(tx, id);
    if (row.status !== 'active' && row.status !== 'paused') throw wrongState(row, 'Cancel');

    await tx.update(runtimeSchedule).set({
      status: 'cancelled', endedAt: now, nextFireAt: null, missedFrom: null, missedTo: null,
      catchupMode: null, catchupCursor: null, catchupTo: null,
    }).where(eq(runtimeSchedule.id, id));
    const waiting = await tx.update(scheduleItemRun).set({ status: 'cancelled' }).where(and(
      inArray(scheduleItemRun.status, ['held', 'start_requested']), runtimeOccurrences(tx, id),
    )).returning({ id: scheduleItemRun.id });
    await tx.update(runtimeScheduleItem).set({ specJsonb: null }).where(eq(runtimeScheduleItem.runtimeScheduleId, id));

    await appendScheduleEvent(tx, {
      runtimeScheduleId: id, action: 'cancelled', actor, detail: { reason: why, cancelledChains: waiting.length },
    });
  });
}

/**
 * Takes an ended Runtime Schedule off the list. It is refused while a run it started is still going,
 * as that run still reports back here. Removing one already removed changes nothing and logs nothing.
 */
export async function removeRuntimeSchedule(db: Db, id: string, actor: ScheduleActor, now: Date): Promise<void> {
  await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const row = await lockRuntime(tx, id);
    if (row.status === 'active' || row.status === 'paused') throw wrongState(row, 'Remove');
    if (row.removedAt) return;
    const [open] = await tx.select({ id: scheduleItemRun.id }).from(scheduleItemRun)
      .where(and(inArray(scheduleItemRun.status, ['started', 'held', 'start_requested']), runtimeOccurrences(tx, id))).limit(1);
    if (open) throw new DaoError('RUNTIME_SCHEDULE_STATE', `${row.label} still has runs going. Remove it when they have ended.`);
    await tx.update(runtimeSchedule).set({ removedAt: now }).where(eq(runtimeSchedule.id, id));
    await appendScheduleEvent(tx, { runtimeScheduleId: id, action: 'removed', actor, detail: { label: row.label, name: row.name } });
  });
}

// ----------------------------------------------------------------------------- disable and re-enable

/** §7.2: a disabled item does not start. Runs already going are untouched, and re-enabling back-fills nothing. */
export async function setRuntimeItemDisabled(
  db: Db, itemId: string, disabled: boolean, actor: ScheduleActor, now: Date,
): Promise<void> {
  await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const [item] = await tx.select({ runtimeId: runtimeScheduleItem.runtimeScheduleId, name: runtimeScheduleItem.masterName })
      .from(runtimeScheduleItem).where(eq(runtimeScheduleItem.id, itemId));
    if (!item) throw new DaoError('RUNTIME_SCHEDULE_NOT_FOUND', 'Runtime Schedule item not found');
    const row = await lockRuntime(tx, item.runtimeId);
    if (row.status !== 'active' && row.status !== 'paused') throw wrongState(row, disabled ? 'Disable' : 'Re-enable');

    const changed = await tx.update(runtimeScheduleItem).set(disabled
      ? { disabled: true, disabledAt: now, disabledBy: actor.kind === 'user' ? actor.userId : null }
      : { disabled: false, disabledAt: null, disabledBy: null })
      .where(and(eq(runtimeScheduleItem.id, itemId), eq(runtimeScheduleItem.disabled, !disabled)))
      .returning({ id: runtimeScheduleItem.id });
    if (changed.length === 0) return;
    await appendScheduleEvent(tx, {
      runtimeScheduleId: item.runtimeId, action: disabled ? 'item_disabled' : 'item_enabled', actor,
      detail: { itemId, name: item.name },
    });
  });
}

// ------------------------------------------------------------------------------------- acknowledge

/**
 * §7.2 Dismiss: clears Needs attention for failed and lost rows of this Runtime, named or all. Any
 * other row, or one already dismissed, is left out of the count. Allowed after the Runtime has
 * ended, since its failures still show. Returns how many were dismissed.
 */
export async function acknowledgeRuntimeItems(
  db: Db, id: string, runIds: string[] | 'all', actor: ScheduleActor, now: Date,
): Promise<number> {
  return db.transaction(async (t) => {
    const tx = t as unknown as Db;
    await lockRuntime(tx, id);
    if (runIds !== 'all' && runIds.length === 0) return 0;
    const dismissed = await tx.update(scheduleItemRun)
      .set({ acknowledgedAt: now, acknowledgedBy: actor.kind === 'user' ? actor.userId : null })
      .where(and(
        inArray(scheduleItemRun.status, ['failed_to_start', 'lost']),
        isNull(scheduleItemRun.acknowledgedAt),
        runtimeOccurrences(tx, id),
        runIds === 'all' ? undefined : inArray(scheduleItemRun.id, runIds),
      )).returning({ id: scheduleItemRun.id });
    if (dismissed.length === 0) return 0;
    await appendScheduleEvent(tx, {
      runtimeScheduleId: id, action: 'items_acknowledged', actor,
      detail: { count: dismissed.length, runIds: dismissed.map((r) => r.id) },
    });
    return dismissed.length;
  });
}
