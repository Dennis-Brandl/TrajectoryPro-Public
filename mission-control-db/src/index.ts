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

// The deliberate public contract surface of mission-control-db (audit item 2).
//
// What belongs here: the wire/domain TYPES the Mission Commander and Mission Pilot mirror,
// the status VOCABULARIES the DB CHECK constraints are generated from, and the
// closed DaoError code set. Renderer bundles must import from here TYPE-ONLY
// (`import type`) — value imports pull in drizzle-orm.
//
// Deep `mission-control-db/src/...` imports keep working via the package.json
// `./src/*` exports passthrough (≈150 existing sites in the engine + CM), but new
// cross-package consumption of contract types should come through this barrel.

// Errors — the closed code set. See dao/errors.ts for the two-way drift guarantee.
export { DaoError, DAO_ERROR_CODES, pgErrorCode, assertDispatchPolicy } from './dao/errors.js';
export type { DaoErrorCode } from './dao/errors.js';

// Status vocabularies + their unions (CHECK constraints are generated from these).
export {
  RUNTIME_WORKFLOW_STATUSES, RUNTIME_ACTIVE_STATUSES, RUNTIME_DELETABLE_STATUSES,
  RUNTIME_FINAL_STATES, ENGINE_STEP_STATES, ASSIGNMENT_STATUSES, LIVE_ASSIGNMENT_STATUSES,
  SIGNATURE_OUTCOMES,
} from './db/schema/execution.js';
export type { RuntimeWorkflowStatus, RuntimeFinalState, EngineStepState, AssignmentStatus, SignatureOutcome } from './db/schema/execution.js';
export { DISPATCH_POLICIES } from './db/schema/work-centers.js';
export type { DispatchPolicy } from './db/schema/work-centers.js';
export { ACCESS_LEVELS } from './dao/access.js';
export type { AccessLevel } from './dao/access.js';

// Row types the schema already derives.
export type { WorkflowInstance, StepInstance, InstanceAssignment, RuntimeHistory, NewRuntimeHistory } from './db/schema/execution.js';

// Runtime-workflow wire types (CM monitoring/control, Pilot workflows tab).
export type {
  RuntimeWorkflowSummary, RuntimeListFilter, RuntimeStatusCounts,
  RuntimeStepClaimant, RuntimeActiveStep, RuntimeWorkflowMonitorSummary,
  RuntimeLiveStep, RuntimeTraceEntryView, RuntimeWorkflowLiveDetail,
  PilotRuntimeWorkflow, PilotLiveAssignment, PilotLiveStep, RuntimeWorkflowLiveStates,
  ActiveRuntimeLeaf, AssignmentCandidate, AssignmentCandidatesView,
} from './dao/runtime-workflows.js';

// Diagram wire types (CM diagram panel, Pilot workflow diagrams).
export type {
  Notation, DiagramStep, DiagramConnection, DiagramSpec, WorkflowDiagram, RuntimeWorkflowDiagram,
} from './dao/workflow-diagram.js';

// History wire types (CM history log).
export type { RuntimeHistorySummary, RuntimeHistoryFilter, RuntimeHistoryDetail } from './dao/runtime-history.js';
export type { TraceEntry, RuntimeHistorySnapshot } from './runtime/engine-access.js';
export type { CreatedRuntimeRow, CreatedRuntimeTarget, CreatedRuntimesPage } from './dao/runtime-children.js';

// E-signature audit rows (spec 2026-09-06 D6).
export type { StepSignature, NewStepSignature, StepSignatureView } from './dao/step-signatures.js';

// Step-run records (spec 2026-10-27: runtime workflow record PDF).
export type { StepRunView } from './dao/step-runs.js';
export type { StepRun, NewStepRun, StepRunResult, StepRunKind, StepRunPathEntry } from './db/schema/execution.js';
export { STEP_RUN_RESULTS, STEP_RUN_KINDS } from './db/schema/execution.js';

// Identity + hierarchy views (CM Planner panes; spec 2026-09-06 — roles are per work center).
export type { AppUser, Role } from './db/schema/identity.js';
export type { WorkCenter } from './db/schema/work-centers.js';
export type { WorkCenterView, UserView, RoleView, WorkflowWithRoleCount } from './dao/hierarchies.js';
export type { UserWorkCenterMembership, RoleWorkCenterMembers } from './dao/work-center-user-roles.js';

// Work-center shared-state wire types (CM Environment / Work Center / Runtime panes, spec §6).
export type {
  ResourceProvenance, SharedResourceHolder, SharedResourceWaiter, SharedResourceView, EnvironmentResourcesView,
  SharedValuePropertyView, EnvironmentValuePropertiesView,
  WorkflowResourceView, InstanceResourcesView, InstanceValuePropertiesView,
} from './dao/shared-state.js';
export type { ResourceSummary } from './runtime/resource-summary.js';
export type { WcWaiterKind, WcResourceType } from './db/schema/work-center-runtime.js';

// Package import/export report types (CM work-center import UI).
export type { ConfigChange, TargetOnlyGrant, ImportReport } from './package/import.js';

// System settings.
export type { ActionMatchingMode, ActionServerTrust, ActionServerPolicy } from './dao/system-settings.js';
export { normalizeActionServerOrigin } from './dao/system-settings.js';

// Pilot theme (spec 2026-10-09 §7, §13). dao/pilot-theme.ts is pure (no drizzle): Commander's
// editor may value-import it by deep path; bundles importing from here stay type-only.
export type {
  PilotTheme, ResolvedTheme, ThemePayload, ColorKey, ThemeMode, FontId, Density, Radius, DefaultMode,
  ThemeLogo, EffectiveColors, ContrastFailure, StatusWarning,
} from './dao/pilot-theme.js';
export type { ThemeChainLayer, BrokenWorkCenter } from './dao/pilot-theme-chain.js';

// Timed GATE wire types (spec 2026-10-13: Pilot Waiting list, live-state countdowns).
export type { GateTimer, GateTimerMode } from './runtime/gate-timer.js';
export type { WaitingStep } from './runtime/inbox.js';

// Disabled-account check shared by Commander's and the engine's better-auth mounts.
export { ACCOUNT_DISABLED_MESSAGE, isUserDisabled } from './dao/account-status.js';
