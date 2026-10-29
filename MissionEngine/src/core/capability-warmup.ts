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
// Data-safety spec 2026-10-21: no network inside a claim transaction. The control pass and the
// gate decide PAUSE/STOP support from ActionClient's in-memory capabilities cache alone
// (commandSupportCached), so this module fills that cache BEFORE they lock anything — only for
// the action servers a pending PAUSE/STOP decision is actually about. A fresh process (empty
// cache) therefore still sees the right answer; an unreachable server stays uncached and reads
// as 'unknown' (spec 2026-10-22 §2), so the pass leaves its command pending and retries it on a
// later turn instead of recording it as handled — never 'unsupported' on a guess.
// An unreachable server can never stall the loop: a failed origin is left alone for
// WARMUP_FAILURE_BACKOFF_MS, concurrent worker slots share one in-flight fetch per origin, and
// origins are warmed in parallel, so a turn waits at most about one fetch timeout.
import { and, eq, inArray, isNotNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { workflowInstance, stepInstance } from 'mission-control-db/src/db/schema/index';
import type { Db } from '../db.js';
import type { ActionClient } from '../actions/client.js';

/** The step states whose action a PAUSE/STOP decision can be about. */
const COMMANDABLE_STATES = ['WAITING_ACTION', 'PAUSED'];

/** After a failed fetch an origin is skipped this long — a dead or blackholed action server costs
 *  at most one bounded fetch per window, never one per worker turn. */
export const WARMUP_FAILURE_BACKOFF_MS = 30_000;

type OriginWarmState = { inFlight?: Promise<void>; failedAt?: number };

/** Per client (a process has one; tests build many), per origin. */
const warmStates = new WeakMap<ActionClient, Map<string, OriginWarmState>>();

function statesFor(client: ActionClient): Map<string, OriginWarmState> {
  let states = warmStates.get(client);
  if (!states) {
    states = new Map();
    warmStates.set(client, states);
  }
  return states;
}

/** Warm one origin. Skips a fresh cache entry and an origin inside its failure backoff, and joins
 *  a fetch another worker slot already has in flight. A failed fetch also evicts any stale entry,
 *  so a server that stopped answering reads as 'unknown' (retried later). Never rejects. */
function warmOrigin(client: ActionClient, uri: string, origin: string): Promise<void> {
  const states = statesFor(client);
  const state = states.get(origin);
  if (state?.inFlight) return state.inFlight;
  if (state?.failedAt !== undefined && Date.now() - state.failedAt < WARMUP_FAILURE_BACKOFF_MS) return Promise.resolve();
  if (client.hasFreshCapabilities(uri)) return Promise.resolve();
  const inFlight = Promise.resolve()
    .then(() => client.capabilities(uri))
    .then(
      () => { states.delete(origin); },
      () => {
        client.invalidateCapabilities(uri);
        states.set(origin, { failedAt: Date.now() });
      },
    );
  states.set(origin, { inFlight });
  return inFlight;
}

/** Data safety round 3 (spec 2026-10-22-data-safety-3 §1): a command send found `serverUri`
 *  unreachable. Drops the origin's cached capabilities, so the next pass reads its commands as
 *  'unknown' and waits, and puts the origin into the same failure back-off a failed warm-up fetch
 *  does, so it is asked again at most once per WARMUP_FAILURE_BACKOFF_MS. Cache-only, no network. */
export function markOriginUnreachable(client: ActionClient, serverUri: string): void {
  client.invalidateCapabilities(serverUri);
  let origin: string;
  try { origin = new URL(serverUri).origin; } catch { return; }
  statesFor(client).set(origin, { failedAt: Date.now() });
}

/** Warm every distinct origin in parallel. A missing or expired entry is (re)fetched, so a
 *  container redeployed with new actions is seen within the cache TTL. */
async function warmOrigins(client: ActionClient, uris: Array<string | null>): Promise<void> {
  const byOrigin = new Map<string, string>();
  for (const uri of uris) {
    if (!uri) continue;
    try { byOrigin.set(new URL(uri).origin, uri); } catch { /* malformed uri: nothing to warm */ }
  }
  await Promise.all([...byOrigin].map(([origin, uri]) => warmOrigin(client, uri, origin)));
}

/** The action servers of the live action steps matching `where` (joined to their instance). */
async function liveActionOrigins(db: Db, where: SQL | undefined): Promise<Array<string | null>> {
  const rows = await db.selectDistinct({ uri: stepInstance.actionServerUri })
    .from(stepInstance)
    .innerJoin(workflowInstance, eq(workflowInstance.id, stepInstance.workflowInstanceId))
    .where(and(
      where,
      isNotNull(stepInstance.actionServerUri), isNotNull(stepInstance.actionInstanceId),
      inArray(stepInstance.state, COMMANDABLE_STATES),
    ));
  return rows.map(r => r.uri);
}

/** `control`: the steps a control pass may still ask about — every WAITING_ACTION step of a
 *  `pausing` instance, and every step of a `stopping` one not yet in `stoppedActions` (runStopping
 *  checks each step once). Resuming and aborting never check capabilities. */
function controlScope(): SQL | undefined {
  return or(
    and(eq(workflowInstance.status, 'pausing'), eq(stepInstance.state, 'WAITING_ACTION')),
    and(
      eq(workflowInstance.status, 'stopping'),
      sql`not (coalesce(${workflowInstance.engineState}->'stoppedActions', '[]'::jsonb) @> to_jsonb(${stepInstance.stepOid}))`,
    ),
  );
}

/** `gate`: only a due ARMED gate that has not sent its STOP — about to open, or already open and
 *  retrying a STOP it could not send yet (spec 2026-10-22 §2). These are the gate paths that ask
 *  about capabilities. Returns its predecessor's server. */
async function gateOrigins(db: Db, now: Date): Promise<Array<string | null>> {
  const gate = alias(stepInstance, 'gate');
  const armed = sql`${workflowInstance.engineState}->'armedGates'->${gate.stepOid}`;
  const rows = await db.selectDistinct({ uri: stepInstance.actionServerUri })
    .from(gate)
    .innerJoin(workflowInstance, eq(workflowInstance.id, gate.workflowInstanceId))
    .innerJoin(stepInstance, and(
      eq(stepInstance.workflowInstanceId, gate.workflowInstanceId),
      sql`${stepInstance.stepOid} = ${armed}->>'predecessorOid'`,
    ))
    .where(and(
      eq(workflowInstance.status, 'running'),
      eq(gate.state, 'WAITING_GATE'), isNotNull(gate.wakeAt), lte(gate.wakeAt, now),
      sql`coalesce((${armed}->>'stopSent')::boolean, true) = false`,
      isNotNull(stepInstance.actionServerUri), isNotNull(stepInstance.actionInstanceId),
      inArray(stepInstance.state, COMMANDABLE_STATES),
    ));
  return rows.map(r => r.uri);
}

/** Warm the capabilities cache before a control pass or a gate pass (scopes above). `now` is the
 *  gate claim's own `asOf`. Never throws. */
export async function warmCapabilities(
  db: Db, client: ActionClient | null, scope: 'control' | 'gate', now: Date = new Date(),
): Promise<void> {
  if (!client) return;
  try {
    const uris = scope === 'control' ? await liveActionOrigins(db, controlScope()) : await gateOrigins(db, now);
    await warmOrigins(client, uris);
  } catch {
    // A failed lookup only means a cold cache — the pass then reads the command as 'unknown'
    // and retries it later.
  }
}

/** The same warm-up for one instance — force complete opens a gate that need not be due. */
export async function warmCapabilitiesForInstance(db: Db, client: ActionClient | null, instanceId: string): Promise<void> {
  if (!client) return;
  try {
    await warmOrigins(client, await liveActionOrigins(db, eq(stepInstance.workflowInstanceId, instanceId)));
  } catch {
    // Best-effort, as above.
  }
}
