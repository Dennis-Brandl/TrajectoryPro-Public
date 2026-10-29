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

export interface InboxTask {
  assignmentId: string;
  stepInstanceId: string;
  stepOid: string;
  stepType: string;
  stepName: string | null;
  instanceId: string;
  runtimeNumber: number;
  runtimeLabel: string;
  masterName: string;
  // Spec 2026-10-09 §5.7. Optional: a snapshot cached in localStorage by an engine from
  // before this change seeds the first frame after a deploy without them.
  masterVersion?: string;
  workflowPath?: string[];
  stepUpdatedAt?: string;
  offeredAt: string;
  claimedAt: string | null;
  suggestedForMe: boolean;
  paused: boolean;
  formDocument: unknown | null;
  yesNoConfig: unknown | null;
  /** Completion-button label authored in Designer's Actions panel; absent/null = Submit (form) or Continue. */
  continueLabel?: string | null;
}

export interface InboxSnapshot {
  workCenterId: string;
  /** Optional for the same cached-snapshot reason as the InboxTask additions. */
  workCenterName?: string | null;
  offers: InboxTask[];
  myClaims: InboxTask[];
  /** Timed gates waiting here (spec 2026-10-13 §5.3). Optional: cached snapshots predate it. */
  waiting?: WaitingStep[];
}

export interface Me {
  id: string;
  email: string;
  displayName: string;
  /** Spec 2026-09-06 D6: what the operator types on an e-signature (prefilled by sub-project 2). */
  loginName: string;
}

export interface WorkCenter {
  id: string;
  name: string;
  /** Ancestor names, root first (spec 2026-10-09 §5.5). Absent from an engine before P1d. */
  path?: string[];
  /** What this operator's inbox there would list: visible offers plus their own live claims. */
  openTasks?: number;
}

/** Spec 2026-09-06 D3: credentials ride a dedicated field, never `values`. */
export interface SignatureBody {
  loginName: string;
  password: string;
}

export type SubmitBody =
  | { kind: 'complete' }
  | { kind: 'submit'; values: Record<string, unknown>; signature?: SignatureBody }
  | { kind: 'decision'; value: 'yes' | 'no'; values?: Record<string, unknown>; signature?: SignatureBody };

// ---- Workflows tab (spec 2026-08-19) ----
// Linked to mission-control-db since the audit-item-2 contract work (type-only imports —
// nothing from the server package reaches the PWA bundle): the Date-free shapes are
// re-exported directly; PilotRuntimeWorkflow's Dates arrive as ISO strings, so it keeps
// a local declaration proven equal to Serialized<dao type> by the guard at the bottom.

export type {
  RuntimeStepClaimant, RuntimeActiveStep,
  PilotLiveAssignment, PilotLiveStep, RuntimeWorkflowLiveStates, GateTimer, WaitingStep,
  Notation, DiagramStep, DiagramConnection, DiagramSpec, RuntimeWorkflowDiagram,
} from 'mission-control-db';
import type { RuntimeActiveStep, RuntimeWorkflowStatus, WaitingStep } from 'mission-control-db';

export interface PilotRuntimeWorkflow {
  id: string;
  workCenterId: string;
  runtimeNumber: number;
  runtimeLabel: string;
  masterName: string;
  masterOid: string;
  masterVersion: string;
  masterState: string;
  status: RuntimeWorkflowStatus;
  createdByName: string | null;
  createdByLabel: string | null;
  createdAt: string;
  queuedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  activeSteps: RuntimeActiveStep[];
  errorText: string | null;
  mine: boolean;
}

// ── Contract drift guard (audit item 2): compile-time proof the serialized mirror above
// still matches the dao type (Date → ISO string). Type-level only.
import type { PilotRuntimeWorkflow as DbPilotRuntimeWorkflow } from 'mission-control-db';
type Serialized<T> = T extends Date ? string
  : T extends (infer U)[] ? Serialized<U>[]
  : T extends object ? { [K in keyof T]: Serialized<T[K]> }
  : T;
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
export type _PilotContractGuards = [
  Expect<Equals<Serialized<PilotRuntimeWorkflow>, Serialized<DbPilotRuntimeWorkflow>>>,
];
