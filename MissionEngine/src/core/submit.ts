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
// Transcribed from the reference repo's engines/web/src/engine.ts:181-259 submitAction,
// including child-engine delegation (Task 12: WORKFLOW PROXY / child-workflow execution) —
// resolved via the target row's own node_oid rather than a runtime walk of activeChildEngines,
// since a step_instance row always already knows which spec owns it. Adapted: the reference
// mutates an in-memory StepInstance synchronously; here every step is a claimed, transacted
// step_instance row, and — per loop.ts's LOCKING PROTOCOL — the instance row is claimed FOR
// UPDATE for the whole call, so completing a step and eagerly cascading everything reachable
// from it (drainCascade — transition.ts) is safe within this ONE transaction: no other worker
// can touch this instance's step rows meanwhile. Task 13 post-review (M8 cleanup): the old
// framing here — submit.ts as "the one sanctioned deviation from 'one transition per
// transaction', confined to this file" — is stale now that drainCascade itself does multiple
// step activations per transaction everywhere (instance.ts's acquire+start, processReadyStep,
// resumeGrantedSteps). The controller-ruled invariant is now "one-cascade-segment-per-
// transaction, bounded by parks + a hard cap" (transition.ts's MAX_CASCADE_ACTIVATIONS) — this
// file has no special exception to carve out anymore; it just drives ONE cascade like every
// other caller.
import { eq, and } from 'drizzle-orm';
import { workflowInstance, stepInstance, instanceAssignment, stepSignature } from 'mission-control-db/src/db/schema/index';
import type { Db } from '../db.js';
import type { EngineDeps } from '../config.js';
import type { UserAction } from '../spec/types.js';
import { openContext } from './context.js';
import { canonicalStepType, getFormElements, handleUserAction } from './step-handlers.js';
import { failStep, finishStep, settleIfComplete, drainCascade } from './transition.js';
import { claimInstanceById } from '../loop.js';
import { reconcileAndNotify } from './reconcile.js';
import type { VerifiedSignature } from './esignature.js';

/** Engine-level error, distinguished by `code` from ordinary Error throws (which submit.ts's
 *  callers — Task 13's conformance harness, and the eventual CM route — surface verbatim to
 *  the reporter/HTTP layer). v1 uses two codes: `NOT_RUNNING` (the instance can't be worked
 *  right now) and `NOT_CLAIMANT` (Task 10: the caller doesn't hold the live claim on the
 *  target step). */
export class EngineError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = 'EngineError';
  }
}

/** The live claim the operator API's caller holds on the target step, per spec §4.3 — checked
 *  by `submitCore`'s claim guard against the CURRENT `instance_assignment` row inside the same
 *  claimed transaction. Omitted entirely by callers that bypass the operator-claim protocol
 *  (the conformance harness, and any other direct engine caller). */
export interface SubmitClaim {
  assignmentId: string;
  userId: string;
  /** Spec 2026-09-06 §5.3: a signature the ROUTE already verified; submitCore records it atomically with completion. */
  signature?: { verified: VerifiedSignature; workCenterName: string; operatorLoginName: string };
}

/**
 * Submit a user action (form submit / button press / YES_NO answer / pause / resume / fail)
 * against a parked step and drive the instance forward. Claims the instance row FOR UPDATE for
 * the whole call (see the header comment above for why), so it is safe to call concurrently
 * with itself and with the worker loop — a racing caller simply blocks behind (or, under
 * `claimInstanceById`'s SKIP LOCKED semantics against a genuinely busy row, throws
 * `EngineError('NOT_RUNNING')` rather than hanging).
 *
 * Task 6: `actionIndex` accepts `'auto'` (the operator API's own callers, which never know a
 * fixture's numeric index) alongside the conformance harness's explicit numeric indices — see
 * `submitCore`'s doc comment for how the two are resolved. `claim`, when supplied, is validated
 * INSIDE this same transaction (spec §4.3) before anything is mutated. `reconcileAndNotify`
 * (Task 5) runs at the tail, exactly like every other instance-claiming transaction (loop.ts's
 * LOCKING PROTOCOL) — closing/creating offers from ground truth and NOTIFYing operator sessions.
 */
export async function submitUserAction(
  db: Db,
  instanceId: string,
  action: UserAction,
  actionIndex: number | 'auto',
  deps: EngineDeps,
  claim?: SubmitClaim,
): Promise<void> {
  await db.transaction(async (tx) => {
    const claimedId = await claimInstanceById(tx, instanceId);
    if (!claimedId) {
      throw new EngineError('NOT_RUNNING', `workflow_instance ${instanceId} is locked by another worker`);
    }
    await submitCore(tx, instanceId, action, actionIndex, deps, claim);
    await reconcileAndNotify(tx, instanceId, deps);
  });
}

/** The original submitUserAction body (Task 10-17), unchanged apart from Task 6's two
 *  insertions: the claim guard (right after the target step is resolved) and the 'auto' ->
 *  numeric resolution of `actionIndex` into `idx` (right after `context` is constructed) — every
 *  later use of the numeric index (failStep/finishStep's own `actionIndex` parameter) now reads
 *  `idx` instead. Split out of `submitUserAction` so the claim-instance-row transaction wrapper
 *  can run `reconcileAndNotify` at its tail without this whole body having to know about it. */
async function submitCore(
  tx: Db,
  instanceId: string,
  action: UserAction,
  actionIndex: number | 'auto',
  deps: EngineDeps,
  claim?: SubmitClaim,
): Promise<void> {
    const [row] = await tx.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
    if (!row || row.status !== 'running') {
      throw new EngineError('NOT_RUNNING', `workflow_instance ${instanceId} is not running`);
    }

    const context = await openContext(tx, row, deps);
    // Task 6: 'auto' draws the next value off the per-instance counter (mutated here, in
    // memory; the shared EngineState object is what every later context.persist(tx) call in
    // this body serializes, so a throw anywhere below rolls this increment back with the
    // transaction — same all-or-nothing guarantee as everything else in EngineState).
    const idx = actionIndex === 'auto' ? context.state.userActionCounter++ : actionIndex;

    const [target] = await tx.select().from(stepInstance)
      .where(and(eq(stepInstance.workflowInstanceId, instanceId), eq(stepInstance.stepOid, action.step_oid)));
    if (!target) throw new Error(`Step ${action.step_oid} not found`);

    // Operator-API claim guard (spec §4.3): the caller must hold the live claim on exactly
    // this step. Checked inside the instance's FOR UPDATE transaction, so a concurrent
    // release/cancel cannot slip between check and submit.
    //
    // Task 10 controller ruling: the claim/release ROUTES mutate this same
    // `instance_assignment` row without ever claiming the workflow_instance row themselves (the
    // instance-row FOR UPDATE above is submit's own device, not theirs). Without `.for('update')`
    // here, this guard read is an ordinary MVCC snapshot read that can't see (or block behind) a
    // route-side release/claim UPDATE racing it — this SELECT is what actually serializes this
    // transaction against those routes, so it has to take the row lock itself.
    if (claim) {
      const [a] = await tx.select().from(instanceAssignment).where(eq(instanceAssignment.id, claim.assignmentId)).for('update');
      if (!a || a.status !== 'claimed' || a.assignedUserId !== claim.userId || a.stepInstanceId !== target.id) {
        throw new EngineError('NOT_CLAIMANT', `assignment ${claim.assignmentId} is not held by the caller for step ${action.step_oid}`);
      }
    }

    // Task 12: delegate to whichever context owns this step — the root, or a (possibly nested)
    // active child. Reference engine.ts:183-194's submitAction walks activeChildEngines
    // looking for one that `hasStep` the target; here the target row's own node_oid already
    // says exactly which context owns it, so no walk is needed.
    const stepCtx = context.contextForNode(target.nodeOid);
    const stepDef = stepCtx.spec.steps.find(s => s.oid === action.step_oid);
    if (!stepDef) throw new Error(`Step ${action.step_oid} not found`);
    const stepType = canonicalStepType(stepDef.step_type);

    if (claim?.signature) {
      const { verified, workCenterName, operatorLoginName } = claim.signature;
      // Spec D6: the signed audit row is atomic with the completion it authorises.
      await tx.insert(stepSignature).values({
        workflowInstanceId: instanceId, runtimeNumber: row.runtimeNumber, runtimeLabel: row.runtimeLabel, workCenterId: row.workCenterId, workCenterName,
        stepInstanceId: target.id, stepOid: target.stepOid,
        stepName: typeof stepDef.local_id === 'string' ? stepDef.local_id : target.stepOid,
        signerUserId: verified.signer.id, signerLoginName: verified.signer.loginName, signerDisplayName: verified.signer.displayName,
        roleId: verified.role?.id ?? null, roleName: verified.role?.name ?? null,
        operatorUserId: claim.userId, operatorLoginName,
        meaning: verified.esig.meaning ?? null, decision: action.button_output ?? null,
        outcome: 'signed', failureCode: null,
      });
      // Same detail-in-`error` convention the operator verbs use — visible in the live trace and the archived history trace.
      await stepCtx.recordTrace(tx, target.stepOid, 'SIGNED', undefined, `${verified.signer.loginName} as ${verified.role?.name ?? 'member'}`);
      // Spec D3: the bound output parameter carries the signer's display name, written by the
      // server. Review fix (fix round 1, finding 3): a malformed block with no fieldName still
      // requires and records a signature (findESignatureBlock fails closed) but has nothing to
      // bind the display name into — skip the override rather than writing under the key ''.
      if (verified.esig.fieldName) {
        action.form_values = { ...(action.form_values ?? {}), [verified.esig.fieldName]: verified.signer.displayName };
      }
    }

    // Pause/resume short-circuit — reference engine.ts:199-207, checked BEFORE the "must be
    // parked" guard below (as the reference does). Silently no-ops if the step isn't
    // currently in a pausable/resumable queue state, mirroring the reference's own silent
    // no-op when `step.state !== 'EXECUTING'` / `!== 'PAUSED'`. Adaptation: the reference
    // restores a single uniform `state = 'EXECUTING'`; we restore the CORRECT queue-vocabulary
    // park state (WAITING_USER vs WAITING_ACTION) by recomputing it from the step's own type
    // rather than persisting a separate "paused from" marker — it's a pure function of
    // needsUserAction/stepType, so there's nothing to lose by not storing it.
    if (action.action === 'pause') {
      if (target.state === 'WAITING_USER' || target.state === 'WAITING_ACTION') {
        await stepCtx.recordTrace(tx, target.stepOid, 'PAUSED');
        await tx.update(stepInstance).set({ state: 'PAUSED', updatedAt: deps.now() }).where(eq(stepInstance.id, target.id));
        await context.persist(tx);
      }
      return;
    }
    if (action.action === 'resume') {
      if (target.state === 'PAUSED') {
        // M2 fix (post-Task-12 review): a WORKFLOW PROXY step also parks WAITING_ACTION (it has
        // an active child, not a real action invocation) — restoring WAITING_USER for it would
        // be wrong just like it would be for ACTION PROXY. childActive is the ground truth
        // (a paused WORKFLOW PROXY row always has one, by construction — it never parks any
        // other way), checked alongside the stepType special-case.
        const isChildParked = stepCtx.state.childActive[action.step_oid] !== undefined;
        const restored = (stepType === 'ACTION PROXY' || isChildParked) ? 'WAITING_ACTION' : 'WAITING_USER';
        await stepCtx.recordTrace(tx, target.stepOid, 'EXECUTING');
        await tx.update(stepInstance).set({ state: restored, updatedAt: deps.now() }).where(eq(stepInstance.id, target.id));
        await context.persist(tx);
      }
      return;
    }

    if (target.state !== 'WAITING_USER' && target.state !== 'WAITING_ACTION') {
      throw new Error(`Step ${action.step_oid} is not EXECUTING`);
    }

    // M1 fix (post-Task-12 review): a WORKFLOW PROXY step parked WAITING_ACTION because it has
    // an active child is not itself actionable — only the CHILD's own steps are (delegated via
    // their own node_oid, resolved into stepCtx above). Accepting a submit/fail directly
    // against the PROXY row here would double-complete it once the child later finishes on its
    // own via completeChildWorkflow (proven: double COMPLETED trace + double routeSuccessors).
    if (stepCtx.state.childActive[action.step_oid] !== undefined) {
      throw new Error(`Step ${action.step_oid} is not EXECUTING`);
    }

    // Spec 2026-10-27 §6.3: the claimant is who performed this step — step-run.ts reads this
    // when the step's run is recorded below (completed, failed or caught).
    if (claim) context.root.stepRunActor = { stepOid: target.stepOid, userId: claim.userId };

    if (action.action === 'fail') {
      // Task 11: failStep now does the real TRY/CATCH dispatch, which can leave the instance
      // running (a catch was armed) rather than always settling terminal. failStep's own
      // catch-activation already cascades the catch network to quiescence internally (via
      // activateAndCascade -> drainCascade — transition.ts), so by the time it returns `false`
      // the whole reachable cascade (e.g. exec-try-catch-002's TIMEOUT->RETRY fixture's
      // catch->RETURN->RETRY chain, re-parking the trigger) has already fully resolved — Task
      // 13 post-review (M8): no separate pump loop is needed here anymore.
      const settled = await failStep(tx, stepCtx, target, action.failure_mode ?? 'ERROR', action.error ?? null, deps, idx);
      if (settled) return;

      // Task 12: settleIfComplete folds the whole-instance isWorkflowComplete+settleTerminal
      // tail into a check that also recognizes "the CHILD that owns this step just finished",
      // recursing up through however many nested WORKFLOW PROXY levels are active.
      await settleIfComplete(tx, context, target.nodeOid, deps);
      await context.persist(tx);
      return;
    }

    const routing = handleUserAction(stepDef, action, stepCtx.props);

    // Snapshot output parameters for this step — reference engine.ts:219-246.
    const snapshot = stepCtx.state.stepSnapshots[target.stepOid];
    if (snapshot) {
      const outputParameters: Record<string, string> = { ...(snapshot.outputParameters ?? {}) };
      for (const spec of stepDef.output_parameter_specifications ?? []) {
        const key = spec.target ?? spec.id;
        const val = stepCtx.props.get(key);
        if (val !== undefined) outputParameters[key] = val;
      }
      if (action.form_values) {
        for (const el of getFormElements(stepDef)) {
          if ('outputParameter' in el && el.outputParameter) {
            const outSpec = stepDef.output_parameter_specifications?.find(s => s.id === el.outputParameter);
            const key = outSpec?.target ?? el.outputParameter;
            const val = stepCtx.props.get(key);
            if (val !== undefined) outputParameters[key] = val;
          }
        }
      }
      snapshot.outputParameters = outputParameters;
    }

    // Store routing context BEFORE completing, so finishStep's routing pass (which reads
    // context.state.routingContext) sees this step's decision — reference engine.ts:253-256.
    if (routing.conditionValue || routing.connectionId) {
      stepCtx.state.routingContext[target.stepOid] = routing;
    }

    // Complete the step — trace COMPLETED carries after_action, per the reference and the
    // conformance harness's expectation. Task 13: finishStep no longer routes this step's own
    // successors (or releases its resource commands) itself — drainCascade does both next,
    // eagerly (BFS), matching the reference's synchronous completionQueue drain exactly (see
    // transition.ts's drainCascade doc comment). Its own internal loop reaches full quiescence
    // for this cascade before returning — Task 13 post-review (M8): no separate trailing pump
    // loop is needed here anymore; drainCascade already processes everything reachable from
    // this action's routing, including any resource releases and the grants they unblock.
    // C1 fix: finishStep returns true iff a nested resumeGrantedSteps cascade already settled
    // the whole instance (a SCRIPT failure via failStep, discovered several calls removed from
    // THIS step's own completion) — in that case stop immediately, same as drainCascade's own
    // "settled" signal right below.
    const settledMidCompletion = await finishStep(tx, stepCtx, target, stepDef, deps, idx);
    if (settledMidCompletion) return;

    const cascadeSettled = await drainCascade(tx, stepCtx, [target.stepOid], deps);
    if (cascadeSettled) return;

    await settleIfComplete(tx, context, target.nodeOid, deps);
    await context.persist(tx);
}
