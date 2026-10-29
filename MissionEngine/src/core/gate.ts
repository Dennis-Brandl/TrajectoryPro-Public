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
// GATE and repeating-SCRIPT due-work (spec 2026-08-29 §6.2; spec 2026-10-13 §6.5): claim ONE
// 'running' instance with a due WAITING_GATE or WAITING_SCRIPT row and evaluate that gate /
// run that script. Same locking protocol as every other unit (claim the workflow_instance row
// FOR UPDATE SKIP LOCKED; step rows never independently locked). Status 'running' ONLY —
// neither evaluates while paused/stopping (§5.7). The claims key on STATE: the due-action claim
// selects WAITING_ACTION/PAUSED (and excludes GATE), this one WAITING_GATE/WAITING_SCRIPT, the
// input-binding claim WAITING_PROPERTIES — the wake_at consumers are disjoint by construction.
// No network inside the claim transaction (data-safety spec 2026-10-21): an armed gate's STOP is
// decided from the capabilities cache (warmed before the claim) and sent after commit.
import { eq, and, isNotNull, lte, inArray } from 'drizzle-orm';
import { workflowInstance, stepInstance } from 'mission-control-db/src/db/schema/index';
import type { Db } from '../db.js';
import type { EngineDeps } from '../config.js';
import type { MasterWorkflowStep } from '../spec/types.js';
import { WorkflowContext, openContext } from './context.js';
import { executeGateScript, gateMode, gateExpired, gateUsesBindings, nextGateWake, formatDuration, scriptExpired, scriptUsesBindings, nextScriptWake } from './step-handlers.js';
import { failStep, settleIfComplete, completeWaitingStep, TERMINAL_STEP_STATES } from './transition.js';
import { evaluateScriptOnClaim } from './repeating-script.js';
import { commandSupportCached, logWaitingForServer, clearWaitingLog, sendAfterCommit, type AfterCommitCommand } from './control.js';
import { warmCapabilities } from './capability-warmup.js';
import { claimInstanceForWork, claimInstanceById, settleFailedInstance, logInstanceSettledError } from '../loop.js';
import { reconcileAndNotify, notifyWorkCenter } from './reconcile.js';
import { fetchPropertyOverlay } from './property-overlay.js';

/** Evaluate one due gate inside the claiming transaction. `overlay` carries freshly-fetched
 *  Action-Property values keyed by parameter id — an evaluation-scoped overlay, never written
 *  into the property store (§5.5). Timed gates (spec 2026-10-13 §3.4) check their deadline
 *  FIRST: an expired gate opens without running its script, and a pure timer never runs one.
 *  Opening an armed gate pushes its predecessor's STOP onto `out` — the caller sends it after
 *  commit. Returns true iff the instance settled. */
export async function evaluateGateOnClaim(
  tx: Db, context: WorkflowContext, row: { id: string; stepOid: string; nodeOid: string; startedAt: Date | null },
  stepDef: MasterWorkflowStep, deps: EngineDeps, out: AfterCommitCommand[], overlay?: Record<string, string>,
): Promise<boolean> {
  // Review fix (Important 2): an already-OPEN armed gate never re-evaluates its script — it is
  // purely waiting on its predecessor's terminal (§5.3.4). Reachable because runResuming
  // (control.ts) re-arms EVERY WAITING_GATE row's wake_at unconditionally on resume, including
  // an open one whose wake_at the TRUE branch below had deliberately nulled — without this
  // short-circuit, a resumed-then-due open gate would re-run its script: FALSE would silently
  // resume cycling while `open` stayed true, and a THROW would delete the armedGates entry via
  // failStep, so the predecessor's later gate-initiated STOPPED would then route as a FAILURE —
  // exactly the outcome monitor.ts's STOPPED override exists to prevent.
  // Spec 2026-10-22 §2: an open gate whose STOP is still pending (the server's capabilities
  // unknown, or the predecessor not yet dispatched) is woken every GATE_STOP_RETRY_MS to retry
  // it — only while the predecessor is still live. Once it ends, the gate just waits (wake null).
  const armed0 = context.root.state.armedGates[row.stepOid];
  if (armed0?.open) {
    if (!armed0.stopSent) {
      const [pred] = await tx.select().from(stepInstance).where(and(
        eq(stepInstance.workflowInstanceId, context.id),
        eq(stepInstance.stepOid, armed0.predecessorOid),
      ));
      if (pred && pred.state !== 'COMPLETED' && !TERMINAL_STEP_STATES.has(pred.state)) {
        await attemptGateStop(tx, context, context.contextForNode(row.nodeOid),
          { id: row.id, stepOid: row.stepOid }, armed0, pred, deps, out);
        await context.persist(tx);
        return false;
      }
      clearWaitingLog(context.id, 'STOP');
    }
    await tx.update(stepInstance).set({ wakeAt: null, updatedAt: deps.now() }).where(eq(stepInstance.id, row.id));
    return false;
  }
  const stepCtx = context.contextForNode(row.nodeOid);
  const mode = gateMode(stepDef);
  // A timed gate records WHY it opened, then takes the single open path.
  const openWithCause = async (cause: string): Promise<boolean> => {
    await stepCtx.recordTrace(tx, row.stepOid, 'OPENED', undefined, cause);
    const settled = await openGateOnClaim(tx, context, stepCtx, row, stepDef, deps, out);
    await notifyWorkCenter(tx, context.workCenterId);
    return settled;
  };
  if (gateExpired(stepDef, deps.now(), row.startedAt)) {
    return await openWithCause(`timer (${formatDuration(stepDef.gate_config?.delay_seconds ?? 0)})`);
  }
  if (mode === 'timer') {
    // Woken early (resume, a property event): sleep to the deadline again.
    await tx.update(stepInstance).set({
      wakeAt: nextGateWake(stepDef, deps.now(), row.startedAt), updatedAt: deps.now(),
    }).where(eq(stepInstance.id, row.id));
    return false;
  }
  // §5.5: EVERY evaluation re-resolves inputs — Value Properties from the live store,
  // bound Action Properties from the overlay.
  stepCtx.props.resolveInputParameters(stepDef.input_parameter_specifications);
  const inputs = { ...stepCtx.props.getInputParameters(), ...(overlay ?? {}) };
  stepCtx.state.stepSnapshots[row.stepOid] = { inputParameters: inputs };
  const target = { id: row.id, stepOid: row.stepOid };

  const result = executeGateScript(stepDef, inputs, deps.config.scriptTimeoutMs);
  if (!result.success) {
    const settled = await failStep(tx, stepCtx, target, 'ERROR', result.error ?? null, deps);
    if (!settled) await settleIfComplete(tx, context, row.nodeOid, deps);
    await context.persist(tx);
    return settled;
  }
  if (!result.open) {
    await tx.update(stepInstance).set({
      wakeAt: nextGateWake(stepDef, deps.now(), row.startedAt), updatedAt: deps.now(),
    }).where(eq(stepInstance.id, row.id));
    await context.persist(tx); // the snapshot above changed engine_state
    return false;
  }
  if (mode === 'condition_or_timer') return await openWithCause('condition');
  return await openGateOnClaim(tx, context, stepCtx, row, stepDef, deps, out);
}

/** Open a gate inside the claiming transaction — the single path for a TRUE evaluation, an
 *  expired timer, and an operator's force complete (spec 2026-10-13 §5.1). An ARMED gate whose
 *  predecessor is still live opens and STOPs it (§5.3.3 of the 2026-08-29 spec) — the STOP is
 *  pushed onto `out` for the caller to send after commit; every other gate completes and
 *  cascades. Returns true iff the instance settled. */
export async function openGateOnClaim(
  tx: Db, context: WorkflowContext, stepCtx: WorkflowContext,
  row: { id: string; stepOid: string; nodeOid: string }, stepDef: MasterWorkflowStep, deps: EngineDeps,
  out: AfterCommitCommand[],
): Promise<boolean> {
  const target = { id: row.id, stepOid: row.stepOid };
  // Open.
  const armed = context.root.state.armedGates[row.stepOid];
  if (armed) {
    const [pred] = await tx.select().from(stepInstance).where(and(
      eq(stepInstance.workflowInstanceId, context.id),
      eq(stepInstance.stepOid, armed.predecessorOid),
    ));
    if (pred && pred.state !== 'COMPLETED' && !TERMINAL_STEP_STATES.has(pred.state)) {
      // §5.3.3: predecessor still live — OPEN the gate (stop cycling) and STOP it.
      armed.open = true;
      await attemptGateStop(tx, context, stepCtx, target, armed, pred, deps, out);
      await context.persist(tx);
      return false;
    }
    if (pred && pred.state === 'COMPLETED') {
      delete context.root.state.armedGates[row.stepOid];
      return await completeGate(tx, context, stepCtx, target, stepDef, deps, row.nodeOid);
    }
    // Defensive: predecessor missing or non-COMPLETED terminal — every path that produces
    // this also tears the gate down (failStep/resets/control sweeps); park open and wait.
    armed.open = true;
    await tx.update(stepInstance).set({ wakeAt: null, updatedAt: deps.now() }).where(eq(stepInstance.id, row.id));
    await context.persist(tx);
    return false;
  }
  return await completeGate(tx, context, stepCtx, target, stepDef, deps, row.nodeOid);
}

/** Spec 2026-10-22 §2: how soon an open gate retries a STOP it could not send yet. */
export const GATE_STOP_RETRY_MS = 5_000;

const STOP_UNSUPPORTED_MESSAGE =
  'gate opened but the running action does not support STOP — waiting for natural completion';

/** Try to send an open armed gate's STOP to its live predecessor. Owns `armed.stopSent` and the
 *  gate row's wake_at. No network inside the claim transaction: support is read from the
 *  capabilities cache (warmed before the claim) and the STOP is pushed onto `out`, sent after
 *  commit (best-effort, 409 tolerated). The STOP is recorded as handled only on a known outcome —
 *  sent, known unsupported, or no client at all — never on a guess (spec 2026-10-22 §2): an
 *  unknown verdict or an undispatched predecessor leaves `stopSent` false and wakes the gate
 *  again in GATE_STOP_RETRY_MS. */
async function attemptGateStop(
  tx: Db, context: WorkflowContext, stepCtx: WorkflowContext, gateRow: { id: string; stepOid: string },
  armed: { predecessorOid: string; open: boolean; stopSent: boolean },
  pred: typeof stepInstance.$inferSelect, deps: EngineDeps, out: AfterCommitCommand[],
): Promise<void> {
  const setGateWake = async (wakeAt: Date | null): Promise<void> => {
    await tx.update(stepInstance).set({ wakeAt, updatedAt: deps.now() }).where(eq(stepInstance.id, gateRow.id));
  };
  const retryAt = (): Date => new Date(deps.now().getTime() + GATE_STOP_RETRY_MS);
  const handled = async (): Promise<void> => {
    armed.stopSent = true; // never re-attempted (§6.4 of the 2026-08-29 spec)
    clearWaitingLog(context.id, 'STOP');
    await setGateWake(null);
  };
  if (armed.stopSent) {
    await setGateWake(null);
    return;
  }
  const client = deps.invoker.client;
  if (!client) {
    // Review fix (Important 3): no dispatching invoker at all (nullActionInvoker / conformance
    // mode) — nothing can ever send this STOP, so say so now and wait for natural completion.
    await stepCtx.recordTrace(tx, gateRow.stepOid, 'WARNING', undefined, STOP_UNSUPPORTED_MESSAGE);
    await handled();
    return;
  }
  if (!pred.actionInstanceId || !pred.actionServerUri) {
    // The gate opened inside the predecessor's invoke window — retry once the dispatch lands.
    await setGateWake(retryAt());
    return;
  }
  const predCtx = context.contextForNode(pred.nodeOid);
  const predDef = predCtx.spec.steps.find(s => s.oid === pred.stepOid);
  const actionOid = pred.actionInvokedOid ?? predDef?.action_proxy_config?.action_oid ?? '';
  const support = commandSupportCached(client, pred.actionServerUri, actionOid, 'STOP');
  if (support === 'supported') {
    out.push({
      serverUri: pred.actionServerUri, actionInstanceId: pred.actionInstanceId, command: 'STOP',
      instanceId: context.id, kind: 'gate-stop', stepRowId: pred.id, stepOid: pred.stepOid, gateOid: gateRow.stepOid,
    });
    // Prompt terminal pickup instead of waiting out the normal poll cadence.
    await tx.update(stepInstance).set({ wakeAt: deps.now(), updatedAt: deps.now() })
      .where(eq(stepInstance.id, pred.id));
    await handled();
  } else if (support === 'unsupported') {
    // Ruling G4: no command — wait for natural completion, visibly.
    await stepCtx.recordTrace(tx, gateRow.stepOid, 'WARNING', undefined, STOP_UNSUPPORTED_MESSAGE);
    await handled();
  } else {
    // The server hasn't told us yet — retry; the warm-up keeps asking it.
    await setGateWake(retryAt());
    logWaitingForServer(context.id, 'STOP', pred.actionServerUri, deps.now().getTime());
  }
}

/** Complete an open gate: COMPLETED + cascade + settle-if-complete (the processReadyStep tail). */
export async function completeGate(
  tx: Db, context: WorkflowContext, stepCtx: WorkflowContext,
  target: { id: string; stepOid: string }, stepDef: MasterWorkflowStep,
  deps: EngineDeps, nodeOid: string,
): Promise<boolean> {
  return await completeWaitingStep(tx, context, stepCtx, target, stepDef, deps, nodeOid);
}

/** Task 6: what the claiming transaction hands off to the outside-any-transaction property
 *  fetch, and back to the fresh re-claim transaction that evaluates with the fetched overlay. */
export const WAITING_STATES = ['WAITING_GATE', 'WAITING_SCRIPT'];

interface PendingGateFetch {
  instanceId: string; stepInstanceId: string; stepOid: string; nodeOid: string; workCenterId: string;
  state: 'WAITING_GATE' | 'WAITING_SCRIPT';
}

/** Sixth unit of work in runOnce. Task 3 handles the no-bindings path (evaluate inside the
 *  claim transaction). Task 6 adds the two-phase bindings path: the claiming transaction only
 *  re-arms wake_at (crash/grace guard) and records what to fetch — the actual REST-11 property
 *  read happens AFTER that transaction commits, never while holding the instance lock (§6.2) —
 *  then a FRESH transaction re-claims, re-checks the row is still live, and evaluates with the
 *  fetched overlay (same shape as loop.ts's invokeDueStep). */
export async function processDueGateWork(db: Db, deps: EngineDeps): Promise<boolean> {
  let claimedInstanceId: string | null = null;
  let pending: PendingGateFetch | null = null;
  let afterCommit: AfterCommitCommand[] = [];
  try {
    // One `asOf` for the warm-up and the claim: a gate the warm-up saw as not yet due must not
    // become due inside the claim with a cold cache (it would burn stopSent as "unsupported").
    const asOf = deps.now();
    await warmCapabilities(db, deps.invoker.client, 'gate', asOf);
    const didWork = await db.transaction(async (tx) => {
      afterCommit = []; // only a committed transaction's commands are ever sent
      const dueCandidates = await tx.select({ workflowInstanceId: stepInstance.workflowInstanceId })
        .from(stepInstance)
        .where(and(
          inArray(stepInstance.state, WAITING_STATES),
          isNotNull(stepInstance.wakeAt), lte(stepInstance.wakeAt, asOf),
        ));
      if (dueCandidates.length === 0) return false;
      const candidateIds = [...new Set(dueCandidates.map(r => r.workflowInstanceId))];
      const instanceId = await claimInstanceForWork(tx, ['running'], inArray(workflowInstance.id, candidateIds));
      if (!instanceId) return false;
      claimedInstanceId = instanceId;
      const [wfRow] = await tx.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
      if (!wfRow) return false;
      const dueRows = await tx.select().from(stepInstance).where(and(
        eq(stepInstance.workflowInstanceId, instanceId),
        inArray(stepInstance.state, WAITING_STATES),
        isNotNull(stepInstance.wakeAt), lte(stepInstance.wakeAt, asOf),
      )).orderBy(stepInstance.wakeAt, stepInstance.id);
      const target = dueRows[0];
      if (!target) {
        // Raced — bump updated_at so claim ordering doesn't head-of-line block (the
        // claimDueActionStep precedent).
        await tx.update(workflowInstance).set({ updatedAt: deps.now() }).where(eq(workflowInstance.id, instanceId));
        return false;
      }
      const context = await openContext(tx, wfRow, deps);
      const found = context.findStep(target.stepOid);
      const stepDef = found?.stepDef;
      if (!stepDef) {
        // Defensive: unresolvable def — clear the timer so the row is never revisited.
        await tx.update(stepInstance).set({ wakeAt: null, updatedAt: deps.now() }).where(eq(stepInstance.id, target.id));
        return true;
      }
      const isScript = target.state === 'WAITING_SCRIPT';
      // An expired timed gate / time-limited script acts without its script, so it never needs
      // a fetch (§3.4, §6.3).
      const expired = isScript
        ? scriptExpired(stepDef, deps.now(), target.startedAt)
        : gateExpired(stepDef, deps.now(), target.startedAt);
      const usesBindings = isScript ? scriptUsesBindings(stepDef) : gateUsesBindings(stepDef);
      // An open armed gate never re-runs its script (it only retries a pending STOP), so it
      // never needs a fetch either.
      const openArmed = !isScript && !!context.root.state.armedGates[target.stepOid]?.open;
      if (!usesBindings || expired || openArmed) {
        if (isScript) await evaluateScriptOnClaim(tx, context, target, stepDef, deps);
        else await evaluateGateOnClaim(tx, context, target, stepDef, deps, afterCommit);
        await reconcileAndNotify(tx, instanceId, deps);
        return true;
      }
      // Bindings: never fetch over the network while holding the instance lock (§6.2).
      // Re-arm one cycle ahead as the crash/grace guard, commit, fetch, then re-check +
      // evaluate in a FRESH transaction (the invokeDueStep pattern).
      await tx.update(stepInstance).set({
        wakeAt: isScript ? nextScriptWake(stepDef, deps.now(), target.startedAt) : nextGateWake(stepDef, deps.now(), target.startedAt),
        updatedAt: deps.now(),
      }).where(eq(stepInstance.id, target.id));
      pending = {
        instanceId, stepInstanceId: target.id, stepOid: target.stepOid,
        nodeOid: target.nodeOid, workCenterId: wfRow.workCenterId,
        state: isScript ? 'WAITING_SCRIPT' : 'WAITING_GATE',
      };
      return true;
    });
    await sendAfterCommit(db, deps.invoker.client, afterCommit, deps);
    if (!pending) return didWork;
    // Local const: `pending` is a `let` reassigned inside the transaction closure above, so TS
    // (correctly) won't carry the null-check narrowing into the nested closures below.
    const gateFetch: PendingGateFetch = pending;
    const isScriptFetch = gateFetch.state === 'WAITING_SCRIPT';
    const fetched = await fetchPropertyOverlay(
      db, deps, gateFetch,
      isScriptFetch ? s => s.action_property_bindings ?? [] : s => s.gate_config?.action_property_bindings ?? [],
      isScriptFetch ? 'input binding' : 'gate binding'); // outside any transaction
    await db.transaction(async (tx) => {
      afterCommit = [];
      const claimedId = await claimInstanceById(tx, gateFetch.instanceId);
      if (!claimedId) return;
      const [wfRow] = await tx.select().from(workflowInstance).where(eq(workflowInstance.id, claimedId));
      if (!wfRow || wfRow.status !== 'running') return;
      const [current] = await tx.select().from(stepInstance).where(eq(stepInstance.id, gateFetch.stepInstanceId));
      if (!current || current.state !== gateFetch.state) return; // resolved/cancelled in the gap
      const context = await openContext(tx, wfRow, deps);
      const found = context.findStep(gateFetch.stepOid);
      const stepDef = found?.context.spec.steps.find(s => s.oid === gateFetch.stepOid);
      if (!stepDef) return;
      if (!fetched.ok) {
        // §5.5: a fetch failure IS an evaluation error — fail the step (TRY-routable, G3).
        const settled = await failStep(tx, context.contextForNode(current.nodeOid),
          { id: current.id, stepOid: current.stepOid }, 'ERROR', fetched.error, deps);
        if (!settled) await settleIfComplete(tx, context, current.nodeOid, deps);
        await context.persist(tx);
        await notifyWorkCenter(tx, wfRow.workCenterId); // the Pilot's Waiting list drops the failed row
      } else {
        if (isScriptFetch) await evaluateScriptOnClaim(tx, context, current, stepDef, deps, fetched.overlay);
        else await evaluateGateOnClaim(tx, context, current, stepDef, deps, afterCommit, fetched.overlay);
        // Spec 2026-09-14 §4.8 (amended after the whole-branch review): a REST-12 event that landed
        // while the fetch above was in flight pulled this row's wake_at to `now` (property-watch.ts's
        // markGatesDue) — and the value the fetch served predates that change. The FALSE branch just
        // re-armed one cycle ahead over the pulled timer, so re-pull: the gate evaluates again on the
        // very next turn of the loop and sees the new value. `current` is the PRE-evaluation row, and
        // the claim transaction had set its wake_at to the next wake (the next cycle or the
        // deadline), strictly after the claim's now, so `<= now` can only mean an event moved it
        // during the fetch. The predicates keep §3's rules: a row that left WAITING_GATE (or WAITING_SCRIPT)
        // (completed, failed) or whose wake_at is now NULL (an armed gate that just opened) is untouched.
        const pulledDuringFetch = current.wakeAt !== null && current.wakeAt.getTime() <= deps.now().getTime();
        if (pulledDuringFetch) {
          await tx.update(stepInstance).set({ wakeAt: deps.now(), updatedAt: deps.now() }).where(and(
            eq(stepInstance.id, current.id), eq(stepInstance.state, gateFetch.state), isNotNull(stepInstance.wakeAt),
          ));
        }
      }
      await reconcileAndNotify(tx, claimedId, deps);
    });
    await sendAfterCommit(db, deps.invoker.client, afterCommit, deps);
    return true;
  } catch (err) {
    // C2 posture (loop.ts): a deterministic per-instance failure must not head-of-line
    // block the claim set — settle that instance errored and keep the loop alive. Logged
    // exactly like loop.ts's action-side twin (GATE follow-up item 7): an instance leaves the
    // claim set on its first failure, so this line can never spam.
    if (!claimedInstanceId) throw err;
    await settleFailedInstance(db, claimedInstanceId, err, deps);
    logInstanceSettledError(claimedInstanceId, err);
    return true;
  }
}
