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
// Operator Stop / Operator Abort cleanup (spec 2026-11-06). While a CATCH cleanup network runs,
// the instance sits in 'stopping_cleanup' / 'aborting_cleanup': running-like for dispatch (READY
// activation, action invoke/monitoring, gates, scripts, property waits, submit, force-complete,
// due-wake, capability warmup, Pilot timed-step listing) but never pausable and never claimed by
// the control pass.
//
// This file holds the pure parts (constants, the row lookup, the phase test). The transactional
// orchestration (afterHaltDrained / startOperatorCleanup / endOperatorCleanup) lives in
// operator-cleanup-flow.ts: it needs transition.ts and context.ts, and those import this file, so
// keeping this one a leaf avoids an import cycle through module-level constants.
import type { MasterWorkflowSpecification, OperatorMode, WorkflowTrySpecification } from '../spec/types.js';
import type { WorkflowContext } from './context.js';
import type { PendingCleanupAbort } from './engine-state.js';

export const RUNNING_LIKE_STATUSES = ['running', 'stopping_cleanup', 'aborting_cleanup'] as const;

export function isRunningLike(status: string): boolean {
  return (RUNNING_LIKE_STATUSES as readonly string[]).includes(status);
}

export type CleanupKind = 'stop' | 'abort';

export const HALT_STATUS: Record<CleanupKind, 'stopping' | 'aborting'> = {
  stop: 'stopping', abort: 'aborting',
};
export const CLEANUP_STATUS: Record<CleanupKind, 'stopping_cleanup' | 'aborting_cleanup'> = {
  stop: 'stopping_cleanup', abort: 'aborting_cleanup',
};
export const FINAL_STATUS: Record<CleanupKind, 'stopped' | 'aborted'> = {
  stop: 'stopped', abort: 'aborted',
};
export const OPERATOR_MODE: Record<CleanupKind, OperatorMode> = {
  stop: 'OPERATOR_STOP', abort: 'OPERATOR_ABORT',
};
export const OPERATOR_ABORT_CONFIRM_TIMEOUT_MS = 30_000;

/** Spec 2026-11-06 U1: the ROOT spec's workflow-level row for this kind, if any. Only ever called
 *  with the root's spec — a child's own Operator rows never fire (C3). */
export function operatorRowFor(spec: MasterWorkflowSpecification, kind: CleanupKind): WorkflowTrySpecification | undefined {
  return spec.try_specifications?.find(t => t.mode === OPERATOR_MODE[kind]);
}

/** Spec 2026-11-06 §5.2 / C11 / C12: whether this Abort takes the confirmed path (halt, wait for
 *  the aborted actions' terminals, then the OPERATOR_ABORT cleanup) rather than today's single
 *  pass. False with no root OPERATOR_ABORT row (C9), when the operator asked to skip, on a
 *  never-started runtime (no step rows, C12), and once an abort halt/cleanup already began (its
 *  later passes, or the skip's re-halt). */
export function wantsConfirmedAbort(root: WorkflowContext, skip: string | null, hasStepRows: boolean): boolean {
  return operatorRowFor(root.spec, 'abort') !== undefined
    && skip !== 'abort'
    && hasStepRows
    && root.state.operatorCleanup?.kind !== 'abort';
}

/** The "cleanup ended: …" reason for an engine-side failure (a recovery settle or a control-pass
 *  give-up), kept to one short line. */
export function engineErrorReason(message: string): string {
  const line = (message.split(/\r?\n/)[0] ?? '').trim();
  return `engine error: ${line.length > 200 ? `${line.slice(0, 197)}...` : line}`;
}

/** True while an Operator cleanup network has been started (phase 'cleanup'). */
export function isCleanupActive(root: WorkflowContext): boolean {
  return root.state.operatorCleanup?.phase === 'cleanup';
}

// ── U6: equipment the workflow already holds when the cleanup begins ──

/** The inheritedHolds / inheritedUse key of an environment-tier resource. Workflow-tier keys
 *  are the manager's own `<ownerOid>:<name>` keys; environment-tier ones are bare names in their
 *  manager, so they are prefixed here to keep the two tiers apart in one list. */
export function envHoldKey(name: string): string {
  return `env:${name}`;
}

/** True when this cleanup-network step's Acquire on `key` is satisfied by a hold the instance
 *  already had when cleanup began (U6). Records it in inheritedUse[stepOid]. */
export function useInheritedHold(root: WorkflowContext, stepOid: string, key: string): boolean {
  const oc = root.state.operatorCleanup;
  if (!oc || oc.phase !== 'cleanup' || !oc.inheritedHolds.includes(key)) return false;
  (oc.inheritedUse[stepOid] ??= []).push(key);
  return true;
}

/** True when a Release on `key` by this step must be a no-op (it never acquired). Consumes one
 *  matching inheritedUse entry: this step's own first, else another cleanup step's (a Release
 *  placed on a later step than its Acquire), so one Release accounts for one inherited Acquire
 *  and a further Release of the same key (the main flow's own hold, released on purpose by the
 *  cleanup) really releases. */
export function releasesInheritedHold(root: WorkflowContext, stepOid: string, key: string): boolean {
  const oc = root.state.operatorCleanup;
  if (!oc || oc.phase !== 'cleanup') return false;
  const owners = [stepOid, ...Object.keys(oc.inheritedUse).filter(s => s !== stepOid)];
  for (const owner of owners) {
    const keys = oc.inheritedUse[owner];
    const idx = keys?.indexOf(key) ?? -1;
    if (idx < 0) continue;
    keys!.splice(idx, 1);
    if (keys!.length === 0) delete oc.inheritedUse[owner];
    return true;
  }
  return false;
}

/** A cleanup step really releases `key` (no inherited Acquire to account for it): the
 *  workflow's original hold is given back, so a later cleanup Acquire on it must go through the
 *  manager again (on the environment tier another instance may take it meanwhile). */
export function forgetInheritedHold(root: WorkflowContext, key: string): void {
  const oc = root.state.operatorCleanup;
  if (!oc || oc.phase !== 'cleanup') return;
  oc.inheritedHolds = oc.inheritedHolds.filter(k => k !== key);
}

// ── live cleanup actions to ABORT + DELETE after commit (operatorCleanup.pendingAborts) ──
//
// The queue itself is durable (engine_state); the loop drains it with finalizeOrphanedActions
// (operator-cleanup-flow.ts). This per-process scan state lives here, in the leaf, so a settle in
// context.ts can queue without importing the flow module.

/** Per process: whether any instance row may still carry pending aborts (true at start-up so a
 *  fresh process scans once), when the next scan may run, and when the last entry was queued
 *  (an empty scan inside the settle window keeps looking: the queuing transaction may not have
 *  committed yet). */
export const pendingAbortScan = { pendingMaybe: true, nextScanAt: 0, lastQueuedAt: 0 };

/** A cleanup end has queued pending aborts (in a transaction that may not have committed yet). */
export function notePendingAbortsQueued(): void {
  pendingAbortScan.pendingMaybe = true;
  pendingAbortScan.nextScanAt = 0;
  pendingAbortScan.lastQueuedAt = Date.now();
}

/** Append live actions to the root's pendingAborts (the caller persists engine_state in the same
 *  transaction) and flag the loop to look for them. No-op for an empty list or no cleanup. */
export function queueCleanupAborts(
  root: WorkflowContext, live: ReadonlyArray<Omit<PendingCleanupAbort, 'queuedAt'>>,
): boolean {
  const oc = root.state.operatorCleanup;
  if (!oc || live.length === 0) return false;
  const queuedAt = new Date().toISOString();
  (oc.pendingAborts ??= []).push(...live.map(a => ({ ...a, queuedAt })));
  notePendingAbortsQueued();
  return true;
}
