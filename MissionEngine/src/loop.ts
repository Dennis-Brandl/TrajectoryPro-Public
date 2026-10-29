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
import { sql, inArray, eq, and, isNotNull, lte, ne, type SQL } from 'drizzle-orm';
import { workflowInstance, stepInstance } from 'mission-control-db/src/db/schema/index';
import { acquireQueuedRuntimeWorkflows } from 'mission-control-db/src/runtime/engine-access';
import { getActionMatchingMode } from 'mission-control-db/src/dao/system-settings';
import type { Db } from './db.js';
import type { EngineDeps } from './config.js';
import { startInstanceFromQueued } from './core/instance.js';
import { processReadyStep, NON_TERMINAL_STEP_STATES, StartRecoveryFailedError } from './core/transition.js';
import { openContext, settleTerminal, findSpecByOid } from './core/context.js';
import { recordFailedActiveRuns } from './core/step-run.js';
import { loadEngineState } from './core/engine-state.js';
import type { MasterWorkflowSpecification } from './spec/types.js';
import { ActionInstanceLost, ActionStatusFailed, BrokerTokenRejected, ActionsKeyRejected } from './actions/client.js';
import { applyActionTerminal, startActionMonitoring, closeMonitoring, ACTION_TERMINAL_BY_SERVER_STATE } from './actions/monitor.js';
import { runControlPass, logWaitingForServer, clearWaitingLog, PAUSE_UNKNOWN_LIMIT_MS } from './core/control.js';
import { runSweep } from './core/sweep.js';
import { reconcileAndNotify } from './core/reconcile.js';
import { processDueGateWork } from './core/gate.js';
import { processDueInputBindingWork } from './core/input-bindings.js';

/**
 * Builds the actual "claim a workflow_instance row for work" query as a drizzle SQL object.
 * claimInstanceForWork executes this directly (no parallel/decorative string) — a test
 * renders it via PgDialect.sqlToQuery and asserts the FOR UPDATE SKIP LOCKED clause is
 * really there, so deleting it from the live query fails the pin instead of leaving it
 * green. Real concurrency behavior is proven against real Postgres in Task 18; PGlite is
 * single-connection.
 */
export function buildClaimInstanceQuery(statuses: string[], extraWhere?: SQL): SQL {
  const statusClause = inArray(workflowInstance.status, statuses);
  const whereClause = extraWhere ? sql`${statusClause} and ${extraWhere}` : statusClause;
  return sql`select id from workflow_instance where ${whereClause} order by updated_at limit 1 for update skip locked`;
}

const READY_STEP_EXISTS = sql`exists (
  select 1 from step_instance si
  where si.workflow_instance_id = workflow_instance.id and si.state = 'READY'
)`;

/**
 * LOCKING PROTOCOL: every unit of work claims the workflow_instance row FOR UPDATE SKIP
 * LOCKED first, so N engine replicas never double-claim it; step_instance rows belonging to
 * an already-locked instance are never independently locked. Internal to loop.ts — callers
 * go through runOnce.
 */
export async function claimInstanceForWork(
  tx: Db,
  statuses: string[],
  extraWhere?: SQL,
): Promise<string | null> {
  const res = await tx.execute(buildClaimInstanceQuery(statuses, extraWhere));
  const row = (res.rows as { id: string }[])[0];
  return row?.id ?? null;
}

/** Claim one specific instance by id (still FOR UPDATE SKIP LOCKED, per protocol) — used by
 *  the C2 failure-recovery path below, and by submit.ts's submitUserAction (Task 10), which
 *  needs the SAME "claim this exact row, back off rather than block if another worker holds
 *  it" semantics before checking status/running. No ORDER BY needed since the id is already
 *  known. SKIP LOCKED here means "if some other worker already has it, back off" rather than
 *  block. */
export async function claimInstanceById(tx: Db, instanceId: string): Promise<string | null> {
  const res = await tx.execute(sql`select id from workflow_instance where id = ${instanceId} for update skip locked`);
  const row = (res.rows as { id: string }[])[0];
  return row?.id ?? null;
}

/** Task 13 post-review (I4 fix): bounded retry cap for `recoverFailedStart` (below) — a
 *  DB-level failure escaping even instance.ts's own inline recovery gets this many chances to
 *  rotate to the back of the queue before it's given up on and settled 'errored'. Deliberately
 *  small — this path is a defense-in-depth backstop for a genuine infrastructure blip, not a
 *  long-running retry policy; a real production tuning knob can move to config.ts later if
 *  needed. */
export const MAX_START_ATTEMPTS = 3;

/**
 * Task 13 post-review (I4 fix): a failure that escapes the WHOLE acquire+start transaction —
 * either because instance.ts's own inline recovery (its narrow try/catch around drainCascade)
 * never ran (the throw came from acquireQueuedRuntimeWorkflows or startInstanceFromQueued's
 * property/resource setup, before that try block), OR because instance.ts's recovery statements
 * THEMSELVES threw (a genuine DB-level failure, not a poisoned workflow — e.g. persist() itself
 * failing) — rolls the ENTIRE transaction back, including the queued->running flip
 * (acquireQueuedRuntimeWorkflows's own UPDATE), reverting the instance to 'queued'. Left alone,
 * `queued_at`-ordered re-acquisition (acquireQueuedRuntimeWorkflows's `order by queued_at`)
 * would re-pick this SAME instance FIRST on every subsequent runOnce cycle forever, permanently
 * starving every other queued instance behind it — the acquire+start analog of C2's
 * head-of-line-blocking guard, but for a class of failure C2's own settleFailedInstance can't
 * reach (that only runs from the processReadyStep claim path).
 *
 * Distinguishes two outcomes, tracked via a small `startAttempts` counter stashed in
 * `engine_state` (the only per-instance JSON scratch space available pre-start — no schema
 * change needed): under `MAX_START_ATTEMPTS`, rotate to the back of the queue (bump `queued_at`
 * to now) so a TRANSIENT blip gets bounded retries rather than either (a) permanently
 * head-of-line-blocking everyone else, or (b) settling 'errored' on the very first hiccup, which
 * would be wrong for something that might succeed on a later attempt. At or past the cap,
 * give up and settle 'errored' — a deterministically-broken instance (as opposed to I3's
 * machine-cycle case, which instance.ts's OWN inline recovery already settles errored
 * immediately, no retry, since it's provably deterministic) must not spin forever either.
 *
 * Runs in its OWN follow-up transaction (the original one already rolled back by the time this
 * is called) — mirrors settleFailedInstance's own claim-then-check-status pattern.
 */
export async function recoverFailedStart(db: Db, instanceId: string, err: unknown, deps: EngineDeps): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  await db.transaction(async (tx) => {
    const claimedId = await claimInstanceById(tx, instanceId);
    if (!claimedId) return; // raced with another worker

    const [row] = await tx.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
    if (!row) return;
    if (row.status !== 'queued') {
      // The failed acquire+start transaction rolled ALL the way back, so this row can only be
      // 'queued' again if nothing else touched it since — anything else (a different worker
      // legitimately re-acquired and resolved it in between, or it's already terminal) must
      // never be clobbered by this stale, second-hand failure. Same "first-resolution-wins"
      // posture as settleFailedInstance's own status guard.
      return;
    }

    const priorState = (row.engineState as { startAttempts?: number } | null) ?? {};
    const attempts = (priorState.startAttempts ?? 0) + 1;

    if (attempts >= MAX_START_ATTEMPTS) {
      // Task 17: centralized through settleTerminal (below) — its guard now takes an explicit
      // `from` argument rather than defaulting to 'running', so a give-up from 'queued' (this
      // row never even started) also gets a matching runtime_history row instead of dying
      // silently. This function's own status guard above already confirmed 'queued' — that's
      // sufficient (this row is held FOR UPDATE for the duration of this transaction, so nothing
      // else can race it here).
      //
      // Deliberately NO `context.persist(tx)` call here (unlike every OTHER settleTerminal call
      // site) — this give-up branch is I4's own backstop for a persist() call that ALREADY threw
      // once (that's how a poisoned instance ends up here at all: instance.ts's own inline
      // recovery tried context.persist(tx) and it failed, escaping the whole acquire+start
      // transaction). A never-started instance's props/state are default/empty regardless, so
      // there is nothing meaningful to flush — settleTerminal itself reads `context.props`/
      // `context.state.stepSnapshots` directly (never re-reads persisted columns), so history
      // is correct without it, and this stays exactly as resilient to a broken persist() as the
      // pre-Task-17 raw UPDATE it replaces (I4's own test injects that exact failure mode).
      const context = await openContext(tx, row, deps);
      await context.recordTrace(tx, null, 'ERRORED', undefined, `${message} (after ${attempts} failed start attempts)`);
      await settleTerminal(tx, context, 'errored', 'errored', deps.now, 'queued');
      await reconcileAndNotify(tx, instanceId, deps);
      return;
    }

    // Bounded retry: rotate to the back of the queue rather than permanently blocking it.
    await tx.update(workflowInstance).set({
      engineState: { ...priorState, startAttempts: attempts },
      queuedAt: deps.now(),
      updatedAt: deps.now(),
    }).where(eq(workflowInstance.id, instanceId));
  });
}

/**
 * A transition threw mid-way through processReadyStep, so its transaction rolled back and
 * `updated_at` never advanced — left alone, claimInstanceForWork's `order by updated_at`
 * would keep re-selecting this SAME instance first forever, wedging every other running
 * instance behind it (C2). Settle it out of the claim set in its own follow-up transaction:
 * mark it 'errored' with a trace entry, error out any of its non-terminal step_instance rows,
 * and stamp completedAt/finalState — mirroring instance.ts's invalid-spec-at-start path.
 *
 * Exported (not just internal to runOnce) so a test can call it directly against a
 * hand-crafted row state — see the status guard below.
 */
export async function settleFailedInstance(db: Db, instanceId: string, err: unknown, deps: EngineDeps): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  await db.transaction(async (tx) => {
    const claimedId = await claimInstanceById(tx, instanceId);
    if (!claimedId) return; // raced with another worker, or it already left the claim set

    const [row] = await tx.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
    if (!row) return;
    if (row.status !== 'running') {
      // Under real multi-worker concurrency (startLoop runs N slots), the transition that
      // threw and rolled back released this row's lock BEFORE this recovery transaction ever
      // ran — a different worker can legitimately re-claim and finish (or otherwise resolve)
      // the instance in between. Only settle an instance that is still 'running'; anything
      // else (already 'completed'/'aborted'/'errored'/'stopped', or moved to another
      // in-flight status) must never be clobbered by this stale, second-hand failure.
      return;
    }

    const context = await openContext(tx, row, deps);
    await context.recordTrace(tx, null, 'ERRORED', undefined, message);
    await recordFailedActiveRuns(tx, context, message);
    await context.persist(tx);

    await tx.update(stepInstance).set({
      state: 'ERRORED', error: message, completedAt: deps.now(), updatedAt: deps.now(),
    }).where(and(
      eq(stepInstance.workflowInstanceId, instanceId),
      inArray(stepInstance.state, NON_TERMINAL_STEP_STATES),
    ));

    await settleTerminal(tx, context, 'errored', 'errored', deps.now);
    await reconcileAndNotify(tx, instanceId, deps);
  });
}

// ── Due-wake: action-step invoke / poll / timeout (Task 15, spec §8) ──
//
// A `step_instance.wake_at` is set by action steps and gates, discriminated by step_type — the
// original ACTION PROXY park (transition.ts, only when `deps.invoker.dispatches`) and this
// section's own re-arming set it for action steps; GATE activation/re-evaluation (transition.ts's
// activateGateStep, core/gate.ts) sets it for gates (Task 12 ruling, still true for the action
// side: a parked WORKFLOW PROXY row also sits at WAITING_ACTION with a NULL action_instance_id,
// but it NEVER gets a wake_at, so it can never be "due"). This query's own `ne(stepType, 'GATE')`
// (below) is what keeps a gate row from ever being claimed here (spec §6.3 — see
// core/gate.ts's processDueGateWork for the disjoint gate-side claim). `action_instance_id IS
// NULL` distinguishes the two phases every due ACTION row can be in: not yet invoked (first
// attempt OR a grace-recovery re-invoke after a crash lost the in-flight record) vs. already
// invoked and due for a poll/timeout check.

function addSeconds(d: Date, secs: number): Date {
  return new Date(d.getTime() + secs * 1000);
}

interface ClaimedDueAction {
  instanceId: string;
  workCenterId: string;
  /** The instance's status AT CLAIM TIME — Task 16 review fix (Critical 4): processDueActionWork
   *  needs this to gate the invoke branch on 'running' specifically, even though the CLAIM itself
   *  (DUE_WORK_STATUSES) is deliberately wider. */
  status: string;
  target: typeof stepInstance.$inferSelect;
}

/** Task 15 review fix (Critical 1, defense in depth): the only queue states a genuine due
 *  action step can be in — a completed/errored/aborted row must never be selected again no
 *  matter what its stale `wake_at` says. The real fix is that every terminal transition now
 *  clears `wake_at` (transition.ts's finishStep/failStep) — this filter is a second, independent
 *  guard so a future bug in THAT invariant degrades to "this row is silently ignored" rather
 *  than "a worker slot spins at 100% CPU polling a dead action forever, starving every other
 *  instance behind it on the claim order". */
const ACTIONABLE_STEP_STATES = ['WAITING_ACTION', 'PAUSED'];

/** Task 16: the instance statuses under which due-wake (invoke/poll/timeout) keeps operating —
 *  widened beyond plain 'running' because spec §7 requires "observation continues" while
 *  paused/pausing (safety polls and SSE stay live for an in-flight action, paused or not) and
 *  during an orderly stop's drain (the whole point of `stopping` is waiting for exactly these
 *  terminals to arrive). READY-step activation (processReadyStep's own claim, above) stays
 *  'running'-only — that half of the freeze is structural and unaffected; this is due-wake's own,
 *  narrower claim for rows that are ALREADY active. 'resuming'/'aborting' are excluded — both
 *  settle within one short, atomic control-pass transaction that itself resolves every row it
 *  touches. */
const DUE_WORK_STATUSES = ['running', 'paused', 'pausing', 'stopping'];

/**
 * Claim ONE instance (in a due-work-eligible status — see DUE_WORK_STATUSES) with a due action
 * step (FOR UPDATE SKIP LOCKED, per the locking protocol) and pick the oldest due row. When it's
 * the invoke path (no action_instance_id yet), re-arms `wake_at` forward by `invokeGraceSecs`
 * BEFORE releasing the lock — a defense-in-depth guard so a second claim of the SAME instance
 * (possible the instant this transaction commits, since the network call below runs entirely
 * outside it) doesn't ALSO attempt to invoke while this attempt is still in flight.
 */
async function claimDueActionStep(db: Db, deps: EngineDeps): Promise<ClaimedDueAction | null> {
  return db.transaction(async (tx) => {
    const asOf = deps.now();
    // Candidate instances (pre-claim read, deliberately un-ordered-by-lock — the claim below is
    // what actually serializes access): any instance with at least one due, actionable step.
    // `deps.now()` is used for the comparison (never SQL `now()`) so tests can drive it via a
    // fake clock.
    const dueCandidates = await tx.select({ workflowInstanceId: stepInstance.workflowInstanceId })
      .from(stepInstance)
      .where(and(
        isNotNull(stepInstance.wakeAt), lte(stepInstance.wakeAt, asOf),
        inArray(stepInstance.state, ACTIONABLE_STEP_STATES),
        ne(stepInstance.stepType, 'GATE'),
      ));
    if (dueCandidates.length === 0) return null;
    const candidateIds = [...new Set(dueCandidates.map(r => r.workflowInstanceId))];

    const instanceId = await claimInstanceForWork(tx, DUE_WORK_STATUSES, inArray(workflowInstance.id, candidateIds));
    if (!instanceId) return null;

    const [row] = await tx.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
    if (!row) return null;

    const dueRows = await tx.select().from(stepInstance).where(and(
      eq(stepInstance.workflowInstanceId, instanceId),
      isNotNull(stepInstance.wakeAt),
      lte(stepInstance.wakeAt, asOf),
      inArray(stepInstance.state, ACTIONABLE_STEP_STATES),
      ne(stepInstance.stepType, 'GATE'),
    )).orderBy(stepInstance.wakeAt, stepInstance.id);

    const target = dueRows[0];
    if (!target) {
      // Raced — another pass already resolved every due row on this instance between the claim
      // predicate matching and this re-select. Bump updated_at so claimInstanceForWork's `order
      // by updated_at asc` doesn't keep re-selecting this instance first forever (same
      // head-of-line-blocking guard as processReadyStep's own no-op-bump, above).
      await tx.update(workflowInstance).set({ updatedAt: deps.now() }).where(eq(workflowInstance.id, instanceId));
      return null;
    }

    if (target.actionInstanceId === null) {
      await tx.update(stepInstance).set({
        wakeAt: addSeconds(deps.now(), deps.config.invokeGraceSecs), updatedAt: deps.now(),
      }).where(eq(stepInstance.id, target.id));
    }

    return { instanceId, workCenterId: row.workCenterId, status: row.status, target };
  });
}

export function findStepDef(spec: MasterWorkflowSpecification, nodeOid: string, stepOid: string) {
  const ownerSpec = findSpecByOid(spec, nodeOid);
  return ownerSpec?.steps.find(s => s.oid === stepOid);
}

/**
 * The frozen recipe's environment specification for a dispatching step (spec 2026-08-20 §4.1).
 * Looks in the OWNING node's spec first — a child workflow can carry environment specs of its
 * own (transition.ts's child activation registers exactly those) — then falls back to the root,
 * which is where a single-level workflow's specs live.
 */
export function findEnvSpec(spec: MasterWorkflowSpecification, nodeOid: string, environmentOid: string) {
  const ownerSpec = findSpecByOid(spec, nodeOid);
  return ownerSpec?.environment_specifications?.find(e => e.oid === environmentOid)
    ?? spec.environment_specifications?.find(e => e.oid === environmentOid);
}

/** Spec 2026-08-21 (action-proxy name binding): same scope precedence as findEnvSpec but
 *  matched by NAME (local_id) — the first scope with any match wins, so an owner-level env
 *  is never shadowed by a root-level one of the same name. */
export function findEnvSpecsByName(spec: MasterWorkflowSpecification, nodeOid: string, environmentName: string) {
  const ownerSpec = findSpecByOid(spec, nodeOid);
  const inOwner = ownerSpec?.environment_specifications?.filter(e => e.local_id === environmentName) ?? [];
  if (inOwner.length > 0) return inOwner;
  return spec.environment_specifications?.filter(e => e.local_id === environmentName) ?? [];
}

/**
 * First invoke (never touched before) OR grace recovery (a prior invoke attempt was lost —
 * e.g. a process crash between recording success and the SSE subscription taking hold; a real
 * production restart clears no state, but a test can simulate it by clearing
 * `action_instance_id` directly). Resolves the environment binding + calls the action server via
 * `deps.invoker.begin()` OUTSIDE any transaction, then records the result in a fresh one.
 */
async function invokeDueStep(db: Db, deps: EngineDeps, claimed: ClaimedDueAction): Promise<void> {
  const { instanceId, workCenterId, target } = claimed;
  const client = deps.invoker.client;
  if (!client) return; // defensive — dispatches=true is what schedules a wake_at in the first place

  const [row] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
  if (!row) return;
  const spec = row.specJsonb as MasterWorkflowSpecification;
  const stepDef = findStepDef(spec, target.nodeOid, target.stepOid);
  const cfg = stepDef?.action_proxy_config;
  if (!cfg) {
    // Defensive: only ACTION PROXY steps ever get a wake_at, so this is unreachable in
    // practice. Clear it anyway so a malformed row is never revisited forever.
    await db.update(stepInstance).set({ wakeAt: null }).where(eq(stepInstance.id, target.id));
    return;
  }

  const engineState = loadEngineState(row.engineState);
  const inputParameters = Object.entries(engineState.stepSnapshots[target.stepOid]?.inputParameters ?? {})
    .map(([name, value]) => ({ name, value }));

  // Spec 2026-08-20: the mode is read PER DISPATCH, not cached at engine start — flipping it in
  // system_settings takes effect on the very next invoke, with no restart. The names come from
  // the frozen recipe (the instance's own spec_jsonb), so a package that was authored against a
  // library still says what its actions were CALLED even when the container's oids differ.
  const matching = await getActionMatchingMode(db);
  // Spec 2026-08-21 (action-proxy name binding): package-internal resolution is
  // mode-agnostic — it decides which embedded env spec speaks for this step (the names,
  // and the binding key), not how the container is matched. Oid first; the config's
  // environment_name is the fallback for packages whose stored oid went stale.
  let envSpec = findEnvSpec(spec, target.nodeOid, cfg.environment_oid);
  if (!envSpec && typeof cfg.environment_name === 'string' && cfg.environment_name.length > 0) {
    const byName = findEnvSpecsByName(spec, target.nodeOid, cfg.environment_name);
    if (byName.length === 0) {
      await applyActionTerminal(db, deps, client, target.id, { kind: 'ERRORED', message: `package resolution: no embedded environment named "${cfg.environment_name}" (step's environment_oid "${cfg.environment_oid}" is not in the package)` });
      return;
    }
    if (byName.length > 1) {
      await applyActionTerminal(db, deps, client, target.id, { kind: 'ERRORED', message: `package resolution: multiple embedded environments named "${cfg.environment_name}" — ambiguous` });
      return;
    }
    envSpec = byName[0];
  }
  const environmentName = envSpec?.local_id ?? cfg.environment_name ?? null;
  const actionName = envSpec?.included_actions?.find(a => (a.action_oid ?? a.oid) === cfg.action_oid)?.action_name
    ?? cfg.action_name ?? null;

  const result = await deps.invoker.begin({
    workCenterId, environmentOid: cfg.environment_oid, actionOid: cfg.action_oid,
    workflowInstanceId: instanceId, stepInstanceId: target.id, stepOid: target.stepOid,
    inputParameters, timeoutMs: cfg.timeout_ms,
    declaredInputNames: (stepDef.input_parameter_specifications ?? []).map((p) => p.id),
    matching, environmentName, actionName,
    bindingEnvironmentOid: envSpec?.oid ?? cfg.environment_oid,
  });

  if (!result.ok) {
    // Brief: invoke-failure (network/non-201, or no binding) -> handleStepFailure('ERROR')
    // immediately. applyActionTerminal's COMPLETED-refetch and delete-instance tail are no-ops
    // here (no action_instance_id was ever recorded) — its claim+guard+failStep+settleIfComplete
    // shape is otherwise identical to what this case needs, so it's reused rather than
    // duplicated.
    await applyActionTerminal(db, deps, client, target.id, { kind: 'ERRORED', message: result.error });
    return;
  }

  const invokedAt = deps.now();
  const nextPoll = addSeconds(invokedAt, deps.config.actionPollSecs);
  const deadline = cfg.timeout_ms !== undefined ? new Date(invokedAt.getTime() + cfg.timeout_ms) : null;
  const wakeAt = deadline && deadline < nextPoll ? deadline : nextPoll;

  let recorded = false;
  await db.transaction(async (tx) => {
    const claimedId = await claimInstanceById(tx, instanceId);
    if (!claimedId) return;
    const [current] = await tx.select().from(stepInstance).where(eq(stepInstance.id, target.id));
    // Conditional on action_instance_id still NULL (guards against a double record) AND the row
    // still sitting in an actionable park state. The state half is Task 16 load-bearing, not
    // defensive: `begin()` above ran entirely OUTSIDE this transaction, so a control pass
    // (stopping/aborting) can commit its own transaction WHILE that network call is still in
    // flight, flipping this row to CANCELLED/ABORTED — action_instance_id alone would still read
    // NULL on that now-terminal row, and without this second check the invoke's success would
    // get stamped onto it anyway (a real action instance silently orphaned behind an already-
    // resolved step). `!current` is unreachable in practice (an already-created row is never
    // deleted by any control pass) but kept for defensive symmetry with every other claim site.
    if (!current || current.actionInstanceId !== null || !ACTIONABLE_STEP_STATES.includes(current.state)) return;
    await tx.update(stepInstance).set({
      actionInstanceId: result.instanceId, actionServerUri: result.serverUri,
      // Spec 2026-08-20 §4.3: what was ACTUALLY invoked on the container (== cfg.action_oid under
      // strict, the name-resolved oid under loose). Command-legality checks read this back.
      actionInvokedOid: result.invokedActionOid,
      startedAt: invokedAt, wakeAt, updatedAt: deps.now(),
    }).where(eq(stepInstance.id, target.id));
    recorded = true;
  });

  if (recorded) {
    void startActionMonitoring(db, deps, client, target.id, result.serverUri, result.instanceId);
  } else {
    // Lost the race recording success (e.g. Task 16's control-pass tore this step down in the
    // gap) — the action instance we just created on the server is now orphaned; best-effort
    // clean it up rather than leaking it.
    await client.deleteInstance(result.serverUri, result.instanceId).catch(() => {});
  }
}

/**
 * Already invoked (`action_instance_id` set) and due for a status check: a timeout past
 * `action_proxy_config.timeout_ms` (best-effort ABORT + a synthetic TIMEOUT terminal) or a
 * poll snapshot (terminal -> applyActionTerminal; `ActionInstanceLost` (404) -> ERRORED
 * "Instance lost on server"; otherwise re-arm `wake_at` for the next poll, bounded by the
 * timeout deadline if one exists). The SSE fast path independently short-circuits most of this
 * (a terminal delivered over SSE reaches applyActionTerminal directly, long before its own
 * `wake_at` would ever come due) — this path is the durable, always-correct backstop.
 */
async function pollDueStep(db: Db, deps: EngineDeps, claimed: ClaimedDueAction): Promise<void> {
  const { instanceId, target } = claimed;
  const client = deps.invoker.client;
  if (!client || !target.actionServerUri || !target.actionInstanceId) return; // defensive

  const [row] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
  if (!row) return;
  const spec = row.specJsonb as MasterWorkflowSpecification;
  const cfg = findStepDef(spec, target.nodeOid, target.stepOid)?.action_proxy_config;
  const invokedAt = target.startedAt ?? deps.now();
  // Controller Ruling B (Task 16 review, Important 2 fix): a genuinely PAUSED step's timeout
  // budget is fully suspended — never enforced while paused; control.ts's runResuming shifts
  // `startedAt` forward by the paused duration on resume, so this SAME deadline computation
  // naturally reflects the REMAINING budget once resumed, with no further changes needed here.
  // A WAITING_ACTION row under a paused/pausing/stopping instance (PAUSE unsupported — still
  // genuinely running server-side) keeps its ORIGINAL deadline and may time out during pause,
  // deliberately unchanged — that failure is simply deferred (Ruling A / monitor.ts) rather than
  // immediately routed.
  const deadline = target.state !== 'PAUSED' && cfg?.timeout_ms !== undefined
    ? new Date(invokedAt.getTime() + cfg.timeout_ms) : null;

  if (deadline && deps.now() >= deadline) {
    // Close the SSE fast path FIRST — best-effort ABORT can itself provoke a real ABORTED
    // state_change from the server, which would otherwise race this call's own synthetic
    // TIMEOUT terminal through applyActionTerminal's "first commit wins" guard. The engine's
    // deliberate classification here is TIMEOUT (so a TRY TIMEOUT catch is what fires), not
    // whatever failure mode the server's own reaction to our ABORT happens to report.
    closeMonitoring(target.id);
    await client.sendCommand(target.actionServerUri, target.actionInstanceId, 'ABORT').catch(() => {});
    await applyActionTerminal(db, deps, client, target.id, { kind: 'TIMEOUT', message: 'action timed out' });
    return;
  }

  // Round 2 (spec 2026-10-23 goal 5): why this check failed, or null when the server answered.
  let pollFailure: string | null = null;
  try {
    const snapshot = await client.getInstance(target.actionServerUri, target.actionInstanceId);
    const kind = ACTION_TERMINAL_BY_SERVER_STATE[snapshot.state];
    if (kind) {
      await applyActionTerminal(db, deps, client, target.id, { kind });
      return;
    }
  } catch (err) {
    if (err instanceof ActionInstanceLost) {
      await applyActionTerminal(db, deps, client, target.id, { kind: 'ERRORED', message: 'Instance lost on server' });
      return;
    }
    // Any other failure (a refused token, not allowlisted, a 5xx, a network error) never fails
    // the step — its own timeout_ms still decides — but is never silent either: it is logged
    // (rate-limited), and after PAUSE_UNKNOWN_LIMIT_MS of failures the step gets one WARNING.
    pollFailure = pollFailureDetail(err);
  }

  const nowMs = deps.now().getTime();
  if (pollFailure !== null) logWaitingForServer(instanceId, 'POLL', target.actionServerUri, nowMs, pollFailure);
  else clearWaitingLog(instanceId, 'POLL');

  const nextPoll = addSeconds(deps.now(), deps.config.actionPollSecs);
  const wakeAt = deadline && deadline < nextPoll ? deadline : nextPoll;
  // No network call from here on: the HTTP check above already ran outside the lock.
  await db.transaction(async (tx) => {
    const claimedId = await claimInstanceById(tx, instanceId);
    if (!claimedId) return;
    const [current] = await tx.select().from(stepInstance).where(eq(stepInstance.id, target.id));
    if (!current || current.actionInstanceId !== target.actionInstanceId) return; // raced/already resolved
    await tx.update(stepInstance).set({ wakeAt, updatedAt: deps.now() }).where(eq(stepInstance.id, target.id));

    // The failure bookkeeping lives in engine_state. Read it cheaply first; open the full
    // context (as applyActionTerminal does) only when something changes.
    const [row] = await tx.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
    if (!row) return;
    const stepOid = current.stepOid;
    const peek = loadEngineState(row.engineState);
    const since = peek.pollFailingSince[stepOid];
    const warned = peek.pollWarned.includes(stepOid);
    if (pollFailure === null) {
      if (since === undefined && !warned) return;
    } else if (since !== undefined && (warned || nowMs - since < PAUSE_UNKNOWN_LIMIT_MS)) {
      return;
    }

    const context = await openContext(tx, row, deps);
    const state = context.root.state;
    if (pollFailure === null) {
      delete state.pollFailingSince[stepOid];
      state.pollWarned = state.pollWarned.filter(oid => oid !== stepOid);
    } else {
      state.pollFailingSince[stepOid] ??= nowMs;
      if (nowMs - state.pollFailingSince[stepOid] >= PAUSE_UNKNOWN_LIMIT_MS && !state.pollWarned.includes(stepOid)) {
        state.pollWarned.push(stepOid);
        await context.contextForNode(current.nodeOid).recordTrace(
          tx, stepOid, 'WARNING', undefined,
          `action server not answering status checks (${pollFailure}) — this action may still be running`,
        );
      }
    }
    await context.persist(tx);
    await reconcileAndNotify(tx, instanceId, deps);
  });
}

/** The `<detail>` of the poll-failure log and WARNING: `HTTP <status>` when the failure carries
 *  an HTTP status (the broker/Autopilot refusals are both 401s), else the error's message. */
function pollFailureDetail(err: unknown): string {
  if (err instanceof ActionStatusFailed) return `HTTP ${err.status}`;
  if (err instanceof BrokerTokenRejected || err instanceof ActionsKeyRejected) return 'HTTP 401';
  return err instanceof Error ? err.message : String(err);
}

/** Third (and last) unit of work runOnce knows: at most one due action step per call, invoke or
 *  poll/timeout as appropriate. No per-instance recovery wrapper is needed here the way
 *  settleFailedInstance backstops processReadyStep — invoke/poll/timeout failures are already
 *  terminal-routed inside invokeDueStep/pollDueStep (via applyActionTerminal), and a transient
 *  poll error is logged and re-armed (one WARNING after 2 minutes) rather than thrown. A
 *  genuine DB-level failure still escapes to runOnce's own generic outer catch, exactly like any other infrastructure blip. */
export async function processDueActionWork(db: Db, deps: EngineDeps): Promise<boolean> {
  const claimed = await claimDueActionStep(db, deps);
  if (!claimed) return false;

  if (claimed.target.actionInstanceId === null) {
    // Task 16 review fix (Critical 4): a never-yet-invoked action row can genuinely exist under a
    // paused/pausing/stopping instance (activation happened just before the freeze took effect) —
    // but NEW dispatch (first invoke, or a grace-recovery re-invoke) must never happen while
    // dispatch is frozen (spec E2: "no new steps activate"). The CLAIM itself stays widened
    // (DUE_WORK_STATUSES) because poll/timeout enforcement for an ALREADY-invoked action still
    // needs to keep operating under those statuses — only the invoke branch is narrowed here.
    // claimDueActionStep's own re-arm-forward-by-invokeGraceSecs already ran before this check, so
    // this row won't be reclaimed again for a while regardless of the decline.
    if (claimed.status !== 'running') return false;
    await invokeDueStep(db, deps, claimed);
  } else {
    await pollDueStep(db, deps, claimed);
  }
  return true;
}

const MAX_LOGGED_CYCLE_MESSAGES = 200;
const CYCLE_ERROR_RELOG_INTERVAL_MS = 60_000;
const lastCycleErrorLoggedAt = new Map<string, number>();

/**
 * Generic (non-instance) cycle errors — e.g. relation-not-exist while e2e infra is still
 * coming up — can legitimately repeat every single runOnce call for a while, so these ARE
 * rate-limited: a bounded map (oldest entry evicted once full) plus a re-log interval, rather
 * than the old "log once, ever" behavior. That old behavior went permanently silent after the
 * first occurrence, which is exactly what hid C2's severity (a wedged engine produced one
 * stderr line, forever). Per-instance failures no longer go through this path at all — see
 * logInstanceSettledError below.
 */
function logCycleErrorOnce(err: unknown, now: () => Date): void {
  const message = err instanceof Error ? err.message : String(err);
  const nowMs = now().getTime();
  const last = lastCycleErrorLoggedAt.get(message);
  if (last !== undefined && nowMs - last < CYCLE_ERROR_RELOG_INTERVAL_MS) return;
  if (last === undefined && lastCycleErrorLoggedAt.size >= MAX_LOGGED_CYCLE_MESSAGES) {
    const oldestKey = lastCycleErrorLoggedAt.keys().next().value;
    if (oldestKey !== undefined) lastCycleErrorLoggedAt.delete(oldestKey);
  }
  lastCycleErrorLoggedAt.set(message, nowMs);
  console.error(`[mission-engine] runOnce cycle error: ${message}`);
}

/** Per-instance transition failures (C2) are settled out of the claim set on their very first
 *  occurrence, so — unlike the generic cycle errors above — the SAME instance can never spam
 *  this. Log every one, unconditionally, with the instance id. */
export function logInstanceSettledError(instanceId: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[mission-engine] instance ${instanceId} settled errored after a transition failure: ${message}`);
}

/** Spacing between retention sweeps (data-safety Task 5): the sweep runs on its own timer, not as
 *  a unit of the work loop, so a backlog can never delay real engine work and an idle loop is
 *  not what drives housekeeping. */
export const SWEEP_INTERVAL_MS = 30_000;
/** The first sweep runs this soon after start, so a restarted engine does not wait a full interval. */
export const SWEEP_FIRST_RUN_MS = 5_000;

/** Start the retention-sweep timer: a first run after SWEEP_FIRST_RUN_MS, then every
 *  SWEEP_INTERVAL_MS. Skips a tick while the previous sweep is still running, logs a failing sweep
 *  once per distinct message, and returns a function that stops both timers. */
export function startSweepTimer(db: Db, deps: EngineDeps): () => void {
  let running = false;
  const tick = (): void => {
    if (running) return;
    running = true;
    runSweep(db, deps.now)
      .catch((err) => logCycleErrorOnce(err, deps.now))
      .finally(() => { running = false; });
  };
  const first = setTimeout(tick, SWEEP_FIRST_RUN_MS);
  const timer = setInterval(tick, SWEEP_INTERVAL_MS);
  first.unref();
  timer.unref();
  return () => { clearTimeout(first); clearInterval(timer); };
}

/**
 * Perform at most one unit of work and report whether it did anything. Never throws — errors
 * are always handled (either by settling the specific failed instance, or by the generic
 * per-cycle catch) so the caller's loop keeps spinning (Task 20 depends on this resilience).
 *
 * Six units of work, tried in order and returning on the first that finds anything to do:
 * acquire a queued instance and start it; advance one READY step on an already-running
 * instance; (Task 15) invoke/poll/timeout one due action step; (spec 2026-08-29) re-evaluate
 * one due GATE; (spec 2026-09-04) acquire one due step's bound Action Properties; (Task 16) perform one control pass (pause/resume/stop/abort) on an instance
 * sitting in a transitional status. The retention sweep is NOT a unit: it has its own timer
 * (startSweepTimer).
 */
async function runOneUnit(db: Db, deps: EngineDeps): Promise<boolean> {
  try {
    // C1: acquire + instance-start is ONE atomic transaction. Splitting them across two
    // separate db.transaction calls meant a crash — or any throw inside the second one, which
    // was silently swallowed — left a durably 'running' instance with zero step rows: the
    // READY-step EXISTS predicate is false for it forever, so no claim path could ever reach
    // it again. acquireQueuedRuntimeWorkflows accepts any PgDatabase (PgTransaction extends
    // it), so it runs on the SAME tx as startInstanceFromQueued.
    //
    // I4 fix (Task 13 post-review): capture the acquired instance's id OUTSIDE the transaction
    // (same pattern as C2's claimedInstanceId, below) so a throw that escapes THIS WHOLE
    // transaction — instance.ts's own inline drainCascade recovery didn't run, or its recovery
    // statements themselves threw (a genuine DB-level failure) — can be handled by a bounded-
    // retry follow-up (recoverFailedStart) instead of silently rolling back to 'queued' and
    // getting re-picked FIRST forever (queued_at ordering has no back-off of its own).
    let acquiredInstanceId: string | null = null;
    try {
      const didAcquire = await db.transaction(async (tx) => {
        const acquired = await acquireQueuedRuntimeWorkflows(tx, 1);
        if (acquired.length === 0) return false;
        acquiredInstanceId = acquired[0].id;
        await startInstanceFromQueued(tx, acquired[0], deps);
        await reconcileAndNotify(tx, acquired[0].id, deps);
        return true;
      });
      if (didAcquire) return true;
    } catch (err) {
      // I4 fix: ONLY a tagged StartRecoveryFailedError (instance.ts's own inline recovery
      // throwing) gets the bounded-retry treatment. Anything else escaping this transaction —
      // most notably the pre-existing C1 atomicity test's own scenario, a throw from the
      // UNTOUCHED happy path that instance.ts's narrow catch never even sees — re-throws here,
      // falling through to the generic outer catch below exactly as before: a silent rollback
      // to 'queued', no attempt tracking, no queued_at rotation. Distinguishing these two is
      // load-bearing, not cosmetic — see StartRecoveryFailedError's own doc comment.
      if (!acquiredInstanceId || !(err instanceof StartRecoveryFailedError)) throw err;
      await recoverFailedStart(db, acquiredInstanceId, err.cause, deps);
      logInstanceSettledError(acquiredInstanceId, err.cause);
      return true;
    }

    // C2: a per-instance transition failure must not wedge every other running instance
    // behind it. claimInstanceForWork orders by updated_at ASC; if processReadyStep throws
    // inside the SAME transaction as the claim, the whole transaction (including any
    // updated_at bump) rolls back, so a deterministically-failing instance would sort first
    // forever. Track the claimed id OUTSIDE the transaction so a throw can be handled with a
    // separate recovery transaction that settles THAT instance out of the claim set.
    let claimedInstanceId: string | null = null;
    try {
      const didWork = await db.transaction(async (tx) => {
        claimedInstanceId = await claimInstanceForWork(tx, ['running'], READY_STEP_EXISTS);
        if (!claimedInstanceId) return false;
        const did = await processReadyStep(tx, claimedInstanceId, deps);
        await reconcileAndNotify(tx, claimedInstanceId, deps);
        return did;
      });
      if (didWork) return true;
    } catch (err) {
      if (!claimedInstanceId) throw err; // the claim itself failed — handle generically below
      await settleFailedInstance(db, claimedInstanceId, err, deps);
      logInstanceSettledError(claimedInstanceId, err);
      return true;
    }

    // Task 15: due action-step work (invoke / poll / timeout) — third unit of work, tried only
    // once the instance has no READY step of its own to advance.
    const didActionWork = await processDueActionWork(db, deps);
    if (didActionWork) return true;

    // GATE spec 2026-08-29 §6.2: re-evaluate one due gate — fourth unit of work, between
    // due-action work and the control passes.
    const didGateWork = await processDueGateWork(db, deps);
    if (didGateWork) return true;

    // Spec 2026-09-04 §5.4.4: acquire one due step's bound Action Properties — fifth unit of
    // work, between due-gate work and the control passes.
    const didInputBindingWork = await processDueInputBindingWork(db, deps);
    if (didInputBindingWork) return true;

    // Task 16: control passes (pause/resume/stop/abort) on instances sitting in a transitional
    // status — the sixth unit of work.
    const didControlWork = await runControlPass(db, deps);
    if (didControlWork) return true;
    return false;
  } catch (err) {
    logCycleErrorOnce(err, deps.now);
    return false;
  }
}

/** The loop's unit of work (runOneUnit, above — its docblock describes the six units), plus
 *  the spec 2026-09-14 §4.7 `onWorkDone` hook: fired after every cycle that did work, never on
 *  an idle one. The hook is guarded — runOnce never throws — and is what the property watch's
 *  debounced reconcile hangs off (index.ts wires it; loop.ts never imports the watcher). */
export async function runOnce(db: Db, deps: EngineDeps): Promise<boolean> {
  const didWork = await runOneUnit(db, deps);
  if (didWork && deps.onWorkDone) {
    try {
      deps.onWorkDone();
    } catch (err) {
      logCycleErrorOnce(err, deps.now);
    }
  }
  return didWork;
}

export interface EngineLoopHandle {
  /** Interrupt every idle slot's wait immediately (called from wake.ts's LISTEN callback). */
  wake: () => void;
  stop: () => void;
}

/**
 * Production worker loop: `config.workerConcurrency` concurrent slots, each looping runOnce;
 * when a slot goes idle (runOnce returned false) it waits on either a wake() call or a 1s
 * timer, whichever comes first. Not used by tests — they drive runOnce directly via
 * pumpUntilQuiet (test/helpers/pump.ts).
 */
export function startLoop(db: Db, deps: EngineDeps): EngineLoopHandle {
  const concurrency = Math.max(1, deps.config.workerConcurrency);
  let stopped = false;
  const idleResolvers = new Set<() => void>();
  const stopSweepTimer = startSweepTimer(db, deps);

  function idleWait(): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(finish, 1000);
      function finish(): void {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        idleResolvers.delete(finish);
        resolve();
      }
      idleResolvers.add(finish);
    });
  }

  async function slot(): Promise<void> {
    while (!stopped) {
      const didWork = await runOnce(db, deps);
      if (didWork) continue;
      await idleWait();
    }
  }

  for (let i = 0; i < concurrency; i++) void slot();

  return {
    wake(): void {
      for (const resolveIdle of [...idleResolvers]) resolveIdle();
    },
    stop(): void {
      stopped = true;
      stopSweepTimer();
    },
  };
}
