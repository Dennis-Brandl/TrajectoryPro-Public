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
// Task 15: the single funnel every action-backed step's terminal reaches through, regardless of
// which of the three triggers noticed it first — an SSE `state_change` event (fast path), a
// due-wake poll that observed a terminal snapshot, or a due-wake timeout (best-effort ABORT +
// a synthetic terminal). A fourth caller (loop.ts's invoke-failure path) also reuses this for
// network/allowlist/non-201 invoke failures, since the "claim + guard on WAITING_ACTION/PAUSED +
// route through failStep + settleIfComplete + persist" shape is identical; the COMPLETED-only
// snapshot re-fetch and the delete-instance tail are simply no-ops when there's no
// action_instance_id yet.
//
// MANDATORY invariant (Task 12 ruling): every caller reaching this module already knows it's
// dealing with a genuine ACTION PROXY row (wake_at is only ever set by ACTION-PROXY-specific
// code — see transition.ts/loop.ts) — but applyActionTerminal's own guard re-checks the row's
// queue state defensively regardless, so a stray call against the wrong step is inert rather
// than corrupting state.
//
// Routing invariant (project-wide): terminal completion/failure ALWAYS goes through
// transition.ts's existing finishStep/failStep/drainCascade — never a parallel routing path.
import { eq } from 'drizzle-orm';
import { workflowInstance, stepInstance } from 'mission-control-db/src/db/schema/index';
import type { WorkflowInstance } from 'mission-control-db/src/db/schema/index';
import type { Db } from '../db.js';
import type { EngineDeps } from '../config.js';
import type { FailureMode } from '../spec/types.js';
import { openContext } from '../core/context.js';
import { finishStep, failStep, drainCascade, settleIfComplete, settleStoppedIfDrained } from '../core/transition.js';
import { claimInstanceById } from '../loop.js';
import { reconcileAndNotify } from '../core/reconcile.js';
import { ActionServerNotAllowed, type ActionClient, type ActionSnapshot, type ServerState } from './client.js';
import type { ActionEvent, SseHandle } from './sse.js';

export type ActionTerminalKind = 'COMPLETED' | 'ABORTED' | 'STOPPED' | 'ERRORED' | 'TIMEOUT';

export interface ActionTerminal {
  kind: ActionTerminalKind;
  message?: string;
}

/** Reference stateMapping.ts:21-31 mapServerStateToFailureMode, extended with the engine's own
 *  synthetic TIMEOUT (never a real ServerState) and folded into ONE lookup this module and
 *  loop.ts's poll path both share. */
export const ACTION_TERMINAL_BY_SERVER_STATE: Partial<Record<ServerState, ActionTerminalKind>> = {
  COMPLETED: 'COMPLETED',
  ABORTED: 'ABORTED',
  STOPPED: 'STOPPED',
  ERRORED: 'ERRORED',
};

const PARKED_STATES = new Set(['WAITING_ACTION', 'PAUSED']);

/** Task 16: statuses under which a terminal reaching this module is still applied at all — spec
 *  §7's Pause paragraph ("observation continues while paused") and Stop paragraph ("terminals
 *  record honestly" during the drain) both require it. `resuming`/`aborting` are deliberately
 *  excluded: both are handled entirely, atomically, within their OWN control-pass transaction
 *  (core/control.ts), which already flips every row it touches OUT of WAITING_ACTION/PAUSED by
 *  the time it commits — a terminal racing into that narrow window is a harmless miss (this
 *  module's own precheck/re-check already guards against acting on a stale row either way), and
 *  self-heals via the next due-wake poll once the row settles, same as any other SKIP-LOCKED
 *  miss elsewhere in this engine. */
const OBSERVABLE_STATUSES = new Set(['running', 'paused', 'pausing', 'stopping']);

/** Terminal mapping table ← stateMapping.ts:21-31 (mapServerStateToFailureMode), plus the
 *  engine-only TIMEOUT case the brief calls out explicitly. */
const TERMINAL_FAILURE_MODE: Partial<Record<ActionTerminalKind, FailureMode>> = {
  ABORTED: 'ABORT',
  STOPPED: 'ABORT',
  ERRORED: 'ERROR',
  TIMEOUT: 'TIMEOUT',
};

/**
 * Apply a terminal outcome to an action-backed step, however it was discovered. Claims the
 * owning workflow_instance row fresh (its OWN transaction — this must be callable from an async
 * SSE `onEvent` callback that has no ambient transaction), conditional on the step still sitting
 * in a live-parked state (WAITING_ACTION or PAUSED — the "completion guard": a step paused by an
 * operator while its action keeps running server-side still completes when the action finishes,
 * exactly like an un-paused one). Two independent triggers racing to report the SAME terminal
 * (e.g. the SSE fast path and a due-wake poll both observing COMPLETED) resolve safely: whichever
 * transaction commits first flips the row out of WAITING_ACTION/PAUSED, so the second is a
 * harmless no-op re-check.
 *
 * COMPLETED re-fetches an AUTHORITATIVE snapshot via `client.getInstance` rather than trusting
 * whatever payload the triggering event carried (an SSE `state_change` event carries no
 * outputs at all; an `output` event may arrive separately or not at all) — mapped through the
 * step's own `output_parameter_specifications` (by id -> target) into the owning context's
 * property store. Data-safety spec 2026-10-21: that fetch happens BEFORE the instance lock is
 * taken (a network call inside a locked transaction holds a pooled connection for its whole
 * duration and can self-deadlock the pool); STOPPED prefetches too, since an open armed gate
 * turns it into a completion inside the lock. A terminal whose step row names a different
 * action instance by the time the lock is held was for a superseded instance and is discarded.
 * Every other kind routes through `failStep` with the terminal mapping table's FailureMode,
 * letting a matching TRY/CATCH swallow it exactly like any other failure.
 *
 * Always tries a best-effort `deleteInstance` afterward (skipped when there's no
 * action_instance_id yet — the invoke-failure case) and tears down any active SSE subscription
 * for this step, regardless of which trigger got here first.
 */
export async function applyActionTerminal(
  db: Db,
  deps: EngineDeps,
  client: ActionClient,
  stepInstanceId: string,
  terminal: ActionTerminal,
): Promise<void> {
  closeMonitoring(stepInstanceId);

  let serverUri: string | null = null;
  let actionInstanceId: string | null = null;

  // Read the step row and fetch the snapshot on the plain db, BEFORE the locking transaction.
  const [precheck] = await db.select().from(stepInstance).where(eq(stepInstance.id, stepInstanceId));
  if (!precheck || !PARKED_STATES.has(precheck.state)) return; // already resolved by a racing trigger
  const prefetchedFor = precheck.actionInstanceId;
  let snapshot: ActionSnapshot | null = null;
  if (precheck.actionServerUri && prefetchedFor) {
    if (terminal.kind === 'COMPLETED') {
      snapshot = await client.getInstance(precheck.actionServerUri, prefetchedFor);
    } else if (terminal.kind === 'STOPPED') {
      // Only used if an open gate makes this a completion; a failed fetch then maps no outputs.
      snapshot = await client.getInstance(precheck.actionServerUri, prefetchedFor).catch(() => null);
    }
  }

  // Everything past the instance claim (below) — extracted so the claiming transaction can
  // always end with reconcileAndNotify regardless of which of applyCore's early returns fires.
  async function applyCore(tx: Db, row: WorkflowInstance): Promise<void> {
    // Task 16: dispatch (successor materialization / TRY-CATCH re-entry) is only ever allowed
    // while the instance is genuinely 'running'. 'paused'/'pausing'/'stopping' still apply the
    // terminal honestly (see below) but never route anything new — see this module's own
    // OBSERVABLE_STATUSES doc comment and spec §7's Pause/Stop paragraphs.
    const allowCascade = row.status === 'running';
    const stopDrain = row.status === 'stopping';

    // Re-read now that the instance is genuinely locked — state may have moved between the
    // pre-check above and acquiring the lock.
    const [current] = await tx.select().from(stepInstance).where(eq(stepInstance.id, stepInstanceId));
    if (!current || !PARKED_STATES.has(current.state)) return;
    // The row moved on to a different action instance (e.g. a grace-recovery re-invoke) while the
    // snapshot was being fetched — this terminal is not its own; leave the row untouched.
    if (current.actionInstanceId !== prefetchedFor) return;

    serverUri = current.actionServerUri;
    actionInstanceId = current.actionInstanceId;

    const context = await openContext(tx, row, deps);
    // Round 2 (spec 2026-10-23 goal 5): this action is over, so its status-check failure run is
    // too — a later run of the same step (a loop) starts with a fresh clock and may warn again.
    delete context.root.state.pollFailingSince[current.stepOid];
    context.root.state.pollWarned = context.root.state.pollWarned.filter(oid => oid !== current.stepOid);
    const stepCtx = context.contextForNode(current.nodeOid);
    const stepDef = stepCtx.spec.steps.find(s => s.oid === current.stepOid);
    if (!stepDef) return; // defensive — every row this engine creates stamps a resolvable stepOid
    const target = { id: current.id, stepOid: current.stepOid };

    // GATE spec 2026-08-29 §5.3.4: a STOPPED terminal for an action whose armed gate is
    // OPEN was gate-initiated — route it as a normal completion (outputs mapped if the
    // server returned any), never through failure handling. Genuine failures
    // (ERRORED/ABORTED) still fail below, and failStep tears the armed gate down.
    let effective = terminal;
    if (terminal.kind === 'STOPPED') {
      const gateOpen = Object.values(context.root.state.armedGates)
        .some(g => g.predecessorOid === current.stepOid && g.open);
      if (gateOpen) effective = { kind: 'COMPLETED' };
    }

    if (effective.kind === 'COMPLETED') {
      if (snapshot) {
        for (const spec of stepDef.output_parameter_specifications ?? []) {
          if (!spec.target) continue;
          const out = snapshot.outputs.find(o => o.name === spec.id);
          if (out) {
            // Spec 2026-10-15 §6.2: an output bound to a whole Value Property (no entry) whose value
            // is the [{name, value}] list form lands entry by entry, exactly as a sync target does.
            // An entry target ('Result.Code') keeps the raw value — unchanged for every existing action.
            if (spec.target.includes('.')) stepCtx.props.set(spec.target, out.value);
            else stepCtx.props.setSyncTarget(spec.target, out.value);
          }
        }
        // Reference engine.ts:1149-1162 parity (mirrors the SCRIPT/finishStep snapshot pattern
        // elsewhere in this file's callers): record what actually landed, keyed by spec id, for
        // CM display / history (Task 17).
        const snap = stepCtx.state.stepSnapshots[current.stepOid];
        if (snap) {
          const outputParameters: Record<string, string> = { ...(snap.outputParameters ?? {}) };
          for (const spec of stepDef.output_parameter_specifications ?? []) {
            if (!spec.target) continue;
            const val = stepCtx.props.get(spec.target);
            if (val !== undefined) outputParameters[spec.id] = val;
          }
          snap.outputParameters = outputParameters;
        }
      }
      const settledMid = await finishStep(tx, stepCtx, target, stepDef, deps);
      if (settledMid) return;
      if (allowCascade) {
        const cascadeSettled = await drainCascade(tx, stepCtx, [target.stepOid], deps);
        if (cascadeSettled) return;
        await settleIfComplete(tx, context, current.nodeOid, deps);
      } else if (!stopDrain) {
        // Task 16: paused/pausing — dispatch frozen, so this step's own successors are never
        // routed now; remember it so the next resume pass can catch up exactly once (spec §7's
        // Pause paragraph: "successors only materialize while the instance is running"). A
        // stopping drain never resumes, so nothing needs remembering there.
        if (!context.root.state.deferredRouting.includes(target.stepOid)) {
          context.root.state.deferredRouting.push(target.stepOid);
        }
      }
      if (stopDrain) await settleStoppedIfDrained(tx, context, deps);
      await context.persist(tx);
      return;
    }

    const message = effective.message ?? `action ${effective.kind.toLowerCase()}`;
    // Every non-COMPLETED ActionTerminalKind reaching here (ABORTED/STOPPED/ERRORED/TIMEOUT) has
    // an entry in TERMINAL_FAILURE_MODE — always defined at runtime.
    const mode = TERMINAL_FAILURE_MODE[effective.kind]!;

    if (stopDrain) {
      // Controller Ruling A (Task 16 review): stopDrain's "no TRY/CATCH" rule stays scoped to
      // `stopping` (spec §7's Stop paragraph, verbatim) — resolved immediately, forced ERRORED,
      // never deferred: an orderly stop never resumes, so there would be nothing to replay a
      // deferral onto.
      await stepCtx.recordTrace(tx, target.stepOid, 'ERRORED', undefined, message);
      await tx.update(stepInstance).set({
        state: 'ERRORED', error: message, completedAt: deps.now(), updatedAt: deps.now(), wakeAt: null,
      }).where(eq(stepInstance.id, target.id));
      await settleStoppedIfDrained(tx, context, deps);
      await context.persist(tx);
      return;
    }

    if (!allowCascade) {
      // Controller Ruling A (Task 16 review, Critical 1 fix): paused/pausing — resolving this
      // failure NOW (via failStep) could activate a fresh CATCH-network cascade, which is exactly
      // as forbidden as a plain completion's successors while dispatch is frozen. But DISCARDING
      // it (the prior behavior) permanently loses whatever TRY/CATCH handler was written for it —
      // proven reachable via a mid-pause TIMEOUT/ERROR on an unsupported-pause action. Defer
      // instead: leave the row's queue state exactly as it was (still WAITING_ACTION/PAUSED, so
      // isWorkflowComplete/settleIfComplete keep correctly refusing to treat the instance as done
      // until this is genuinely resolved), clear wake_at (the terminal outcome is already known —
      // no reason to keep polling), and record enough to replay through failStep, verbatim,
      // exactly once resume runs (core/control.ts's drainDeferredWork).
      await tx.update(stepInstance).set({ wakeAt: null, updatedAt: deps.now() }).where(eq(stepInstance.id, target.id));
      if (!context.root.state.deferredFailures.some(f => f.stepOid === target.stepOid)) {
        context.root.state.deferredFailures.push({ stepOid: target.stepOid, mode, message });
      }
      await context.persist(tx);
      return;
    }

    const settled = await failStep(tx, stepCtx, target, mode, message, deps);
    if (settled) return;
    await settleIfComplete(tx, context, current.nodeOid, deps);
    await context.persist(tx);
  }

  await db.transaction(async (tx) => {
    const claimedId = await claimInstanceById(tx, precheck.workflowInstanceId);
    if (!claimedId) return; // another worker holds the instance right now — nothing lost, row untouched

    const [row] = await tx.select().from(workflowInstance).where(eq(workflowInstance.id, claimedId));
    if (!row || !OBSERVABLE_STATUSES.has(row.status)) return;

    await applyCore(tx, row);
    await reconcileAndNotify(tx, claimedId, deps);
  });

  if (serverUri && actionInstanceId) {
    await client.deleteInstance(serverUri, actionInstanceId).catch(() => {});
  }
}

// ── SSE fast path ──

const activeSubscriptions = new Map<string, SseHandle>();

/** Registers a step's active SSE handle, closing (and replacing) whatever was previously
 *  registered for the same step first — a grace-recovery re-invoke can create a NEW action
 *  instance while an old subscription (for an abandoned instance id) is still technically live;
 *  never leak it. */
function registerSseHandle(stepInstanceId: string, handle: SseHandle): void {
  activeSubscriptions.get(stepInstanceId)?.close();
  activeSubscriptions.set(stepInstanceId, handle);
}

/** Stops and forgets any active SSE subscription for a step — called unconditionally at the top
 *  of applyActionTerminal (the step is about to leave its parked state one way or another) and
 *  available for callers (Task 16's control passes) that need to tear one down early. */
export function closeMonitoring(stepInstanceId: string): void {
  activeSubscriptions.get(stepInstanceId)?.close();
  activeSubscriptions.delete(stepInstanceId);
}

/** TEST-ONLY: read-only peek at whether a step currently holds ANY `activeSubscriptions` entry
 *  (a real SSE handle or the registration placeholder). Never called by production code —
 *  `closeMonitoring` is the production accessor and it mutates (closes + deletes) as a side
 *  effect, which makes it unusable as a pure observation in a test asserting "nothing leaked". */
export function hasActiveSubscription(stepInstanceId: string): boolean {
  return activeSubscriptions.has(stepInstanceId);
}

/**
 * Open the SSE fast path for a just-invoked action instance. Spec 2026-09-14 §4.6: the stream
 * opens through `client.subscribeInstanceEvents`, which asserts the SAME DB-backed allowlist
 * policy every fetch asserts (spec 2026-09-05: read live, per call, no cache) before ever
 * opening the connection — one path for both event streams. In practice `serverUri` always
 * already passed that check moments earlier (it's the exact value `httpActionInvoker.begin()`
 * just used to invoke successfully) — defense in depth, not a load-bearing gate.
 *
 * This function NEVER REJECTS — its only caller (loop.ts) invokes it as a bare fire-and-forget
 * `void startActionMonitoring(...)`, with nothing to attach a `.catch` to. A failed policy read
 * (system_settings is a live DB read now) is caught below and logged instead of propagated; a
 * not-allowed origin is skipped silently: skipping the SSE fast path for this step is always
 * safe — the durable poll path in loop.ts is the correctness backstop and will pick the step up
 * on its own next due cycle.
 *
 * Task 2 review fix round 1 (2026-09-05): making the policy check a live Postgres round trip
 * opened a close-then-register window that didn't exist when it was a synchronous in-memory
 * check — a concurrent `closeMonitoring(stepInstanceId)` (an operator ABORT pass in
 * core/control.ts, or the timeout path in loop.ts) arriving WHILE the policy read is still
 * awaiting the DB would find nothing registered yet (a no-op), and a late registration below
 * would then install a subscription for a step that's already torn down — a leaked
 * `activeSubscriptions` entry (nothing ever sweeps the map) plus an open HTTP event stream to the
 * action server. Fixed by reserving this step's slot with a cancellable placeholder BEFORE the
 * await, so a concurrent `closeMonitoring` has something real to close, and by re-checking the
 * map's identity AFTER the await — closing the just-opened stream when the slot moved on —
 * invariant preserved on every exit path: `activeSubscriptions` ends up holding either the real
 * handle or nothing for this step, never a stale live placeholder.
 */
export async function startActionMonitoring(
  db: Db,
  deps: EngineDeps,
  client: ActionClient,
  stepInstanceId: string,
  serverUri: string,
  actionInstanceId: string,
): Promise<void> {
  // Reserve the slot synchronously, before the policy read's await, so a racing closeMonitoring
  // finds something to close instead of no-oping on an empty map. `cancelled` flips true iff
  // THIS placeholder is the one closeMonitoring (or applyActionTerminal, which calls it
  // unconditionally) closed — registerSseHandle's own "close whatever was there first" behavior
  // means a DIFFERENT step's teardown can never trip it.
  let cancelled = false;
  const placeholder: SseHandle = { close() { cancelled = true; } };
  registerSseHandle(stepInstanceId, placeholder);

  // Removes the map entry only if it still holds THIS placeholder — never touches a real handle
  // or a newer placeholder/handle installed by a superseding call (e.g. a grace-recovery
  // re-invoke racing this one for the same step).
  const clearPlaceholder = (): void => {
    if (activeSubscriptions.get(stepInstanceId) === placeholder) activeSubscriptions.delete(stepInstanceId);
  };

  let handle: SseHandle;
  try {
    handle = await client.subscribeInstanceEvents(serverUri, actionInstanceId, (event: ActionEvent) => {
      if (event.kind !== 'state_change') return;
      const kind = ACTION_TERMINAL_BY_SERVER_STATE[event.state];
      if (!kind) return;
      // Task 15 review fix (Critical 3): applyActionTerminal is a genuine throwing surface here
      // (e.g. client.getInstance's COMPLETED re-fetch can throw ActionInstanceLost if the server
      // reaps the instance between this event and the refetch, or a plain Error on a 5xx; the
      // claim transaction can also throw on a deadlock/connection blip) — this callback has no
      // caller to propagate a rejection TO, so an uncaught one becomes an unhandled promise
      // rejection, which crashes the whole engine process under Node's default policy. Caught and
      // logged instead: the SSE fast path failing is never fatal — the durable poll path (loop.ts)
      // is the correctness backstop and will pick this step up again on its own next due cycle.
      applyActionTerminal(db, deps, client, stepInstanceId, { kind }).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[mission-engine] SSE-triggered applyActionTerminal failed for step ${stepInstanceId}: ${message}`);
      });
    });
  } catch (err) {
    // Not allowed: the same silent skip the fetch path's ActionServerNotAllowed means here.
    // Anything else is a failed policy read — see the docblock above.
    if (!(err instanceof ActionServerNotAllowed)) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[mission-engine] action-server policy read failed; SSE monitoring skipped for step ${stepInstanceId}: ${message}`);
    }
    clearPlaceholder();
    return;
  }
  // Belt-and-suspenders re-check: `cancelled` only catches a close of THIS placeholder, but the
  // map could also have moved on to a genuinely newer registration for this same step while we
  // awaited — either way, if it's no longer exactly our placeholder, the stream just opened must
  // not be installed; close it so nothing leaks.
  if (cancelled || activeSubscriptions.get(stepInstanceId) !== placeholder) {
    handle.close();
    clearPlaceholder();
    return;
  }
  registerSseHandle(stepInstanceId, handle);
}
