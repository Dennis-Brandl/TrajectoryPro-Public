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

//
// Spec 2026-11-06 (Operator Stop/Abort) U8: the append-only record of who sent every Stop, Abort
// and skip-cleanup. Rows carry no FK to the instance so they outlive it, like step_run.
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { runtimeControlEvent } from '../db/schema/execution.js';
import type { Schema } from '../db/client.js';

type Db = PgDatabase<any, Schema>;

export type ControlActor =
  | { kind: 'user'; userId: string }
  | { kind: 'remote'; label: string; instanceId: string | null }
  | { kind: 'system'; label: string };
export type ControlVerb = 'stop' | 'abort';
export type ControlEffect = 'request' | 'escalate' | 'skip_cleanup';

export interface ControlEventView {
  at: string; verb: ControlVerb; effect: ControlEffect; fromStatus: string; toStatus: string;
  actorKind: ControlActor['kind']; actorUserId: string | null;
  /** user: display_name; remote/system: label. */
  actorName: string;
  /** remote: the sender's own runtime id (parent / calling instance), when known; else null. */
  actorInstanceId: string | null;
}

const COLS = {
  at: runtimeControlEvent.at, verb: runtimeControlEvent.verb, effect: runtimeControlEvent.effect,
  fromStatus: runtimeControlEvent.fromStatus, toStatus: runtimeControlEvent.toStatus,
  actorKind: runtimeControlEvent.actorKind, actorUserId: runtimeControlEvent.actorUserId,
  actorLoginName: runtimeControlEvent.actorLoginName, actorDisplayName: runtimeControlEvent.actorDisplayName,
  actorLabel: runtimeControlEvent.actorLabel, actorInstanceId: runtimeControlEvent.actorInstanceId,
};

function toView(r: {
  at: Date; verb: string; effect: string; fromStatus: string; toStatus: string; actorKind: string;
  actorUserId: string | null; actorLoginName: string | null; actorDisplayName: string | null; actorLabel: string | null;
  actorInstanceId: string | null;
}): ControlEventView {
  return {
    at: r.at.toISOString(), verb: r.verb as ControlVerb, effect: r.effect as ControlEffect,
    fromStatus: r.fromStatus, toStatus: r.toStatus, actorKind: r.actorKind as ControlActor['kind'],
    actorUserId: r.actorUserId,
    actorName: r.actorKind === 'user' ? (r.actorDisplayName ?? r.actorLoginName ?? '') : (r.actorLabel ?? ''),
    actorInstanceId: r.actorInstanceId,
  };
}

/** Oldest first; id breaks same-instant ties. */
export async function listControlEvents(db: Db, instanceId: string): Promise<ControlEventView[]> {
  const rows = await db.select(COLS).from(runtimeControlEvent)
    .where(eq(runtimeControlEvent.workflowInstanceId, instanceId))
    .orderBy(asc(runtimeControlEvent.at), asc(runtimeControlEvent.id));
  return rows.map(toView);
}

export async function latestControlEvent(db: Db, instanceId: string, verb: ControlVerb): Promise<ControlEventView | null> {
  const [row] = await db.select(COLS).from(runtimeControlEvent)
    .where(and(eq(runtimeControlEvent.workflowInstanceId, instanceId), eq(runtimeControlEvent.verb, verb)))
    .orderBy(desc(runtimeControlEvent.at), desc(runtimeControlEvent.id)).limit(1);
  return row ? toView(row) : null;
}

export async function deleteControlEventsForInstances(db: Db, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.delete(runtimeControlEvent).where(inArray(runtimeControlEvent.workflowInstanceId, ids));
}
