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
// Renderer-side wire types. Since the audit-item-2 contract work, the hand-mirrors here
// are LINKED to mission-control-db (type-only — nothing from the server package reaches
// the browser bundle):
//  - shapes identical to the DAO's are re-exported directly;
//  - shapes whose Dates arrive as ISO strings keep a local declaration that is proven
//    equal to Serialized<DaoType> by the drift guards at the bottom of this file — a DAO
//    shape change now breaks the build here instead of silently drifting at runtime.
export type WcNode = { id: string; name: string; parentWorkCenterId: string | null; depth: number; typeName: string | null };
export type WorkCenter = { id: string; name: string; description: string | null; parentWorkCenterId: string | null; sortOrder: number; dispatchPolicy: string; autoClaim: boolean; runtimeIdTemplate: string | null; typeName: string | null; createdAt: string; updatedAt: string };
// Mirrors mission-control-db's WorkflowSummary / EnvironmentSpecSummary. M6: the grouping
// container is the WORK CENTER, not a library — an artifact is OWNED by exactly one work
// center. sourceLibrary* is Designer's originating library: provenance for display only
// (spec D9), never routing or grouping. effectiveFrom is a Date on the wire → string here.
export type Workflow = { id: string; oid: string; name: string; workCenterId: string; workCenterName: string; version: string; state: string; effectiveFrom: string | null; dispatchPolicy: string | null; autoClaim: boolean | null; typeName: string | null; sourceLibraryName: string | null; sourceLibraryOid: string | null };
// Mirrors mission-control-db's WorkflowWithRoleCount. Deliberately a separate type rather
// than a field on Workflow: RoleView.workflows and workflows.list() do NOT project this
// column, and widening the shared type would misdeclare both of those payloads.
export type WorkflowWithRoleCount = Workflow & { allowedRoleCount: number };
// EnvironmentSpecSummary carries no dispatchPolicy — that is a workflow-only column.
export type EnvironmentSpec = { id: string; oid: string; name: string; workCenterId: string; workCenterName: string; version: string; state: string; effectiveFrom: string | null; sourceLibraryName: string | null; sourceLibraryOid: string | null };
export type AppUser = { id: string; email: string; loginName: string; displayName: string; status: string; accessLevel: string };
export type Role = { id: string; name: string; description: string | null };
// Spec 2026-09-06: roles are held PER WORK CENTER. A member row carries the roles held there.
export type WorkCenterMember = AppUser & { missionSystemCommander: boolean; roles: Role[] };
export type UserWorkCenterMembership = { workCenter: WorkCenter; missionSystemCommander: boolean; roles: Role[] };
export type RoleWorkCenterMembers = { workCenter: WorkCenter; users: AppUser[] };
// workflows is plain rows now — the work_center_workflow link row that carried linkId and
// its own dispatchPolicy is gone, so there is nothing to wrap.
export type WorkCenterView = {
  workCenter: WorkCenter; subtree: WcNode[];
  workflows: WorkflowWithRoleCount[]; users: WorkCenterMember[];
  environments: EnvironmentSpec[]; roles: Role[];
};
export type MePrincipal = { id: string; email: string; loginName: string; displayName: string; accessLevel: string; isAdministrator: boolean; rights: string[]; missionSystemCommanderOf: string[] };
export type UserView = { user: AppUser; workCenters: UserWorkCenterMembership[] };
export type RoleView = { role: Role; members: RoleWorkCenterMembers[]; workflows: Workflow[] };
export type AllowedRoleNode = { nodeId: string; nodeName: string; depth: number; ownsUiSteps: boolean; roleIds: string[] };
// M6 keys allowed roles on the workflow ENTRY. Two work centers holding the same oid are
// separate entries with separate assignments, so there is no link id to key on.
export type AllowedRolesView = { workflowId: string; nodes: AllowedRoleNode[] };

// POST /api/work-centers/:id/load — one result per (file × work center) pair. Which of the
// optional fields are populated depends on `kind`: the workflow ingest reports counts and
// carry-over, the environment ingest reports its per-spec list.
export type LoadResult = {
  filename: string;
  workCenterId: string;
  kind: 'workflow' | 'environment';
  status: 'loaded' | 'replaced' | 'already_present' | 'failed';
  message?: string;                     // failed: the reason; already_present: why nothing changed
  updatedWorkflows?: string[];          // environment packages: workflows that picked up a replaced env
  nodesRemoved?: number; nodesRetained?: number; grantsDropped?: number; // workflow replace
  name?: string; version?: string; state?: string;
  nodeCount?: number; uiStepCount?: number; envCount?: number;
  rolesCarried?: number;
  // Names of the roles this load CREATED because an e-signature block named a role that did
  // not exist yet (mission-control-db ingest/signature-roles.ts). Roles that already existed
  // are linked silently.
  rolesCreated?: string[];
  // Percent-escaped node paths whose roles could NOT be carried over. Escaping is '%'→%25
  // BEFORE '/'→%2F, so these must be decoded before display (spec §6.3).
  unmatchedPaths?: string[];
  specs?: { id: string; name: string; version: string; state: string; status: 'loaded' | 'replaced' | 'already_present' }[];
  // Non-fatal problems found while loading — today, shared-resource name collisions between
  // two environments in one work center. A conflict never fails a load (managing the name
  // space is the workflow author's responsibility), so this is the only channel that reports it.
  warnings?: string[];
};
export type LoadResponse = { results: LoadResult[] };

// The 409 body of the first DELETE /api/work-centers/:id — what a confirmed delete would
// destroy. hasChildren refuses regardless of confirmation (spec §8.3).
export type DeleteImpact = { workflows: number; environments: number; instances: number; stepInstances: number; schedules: number; hasChildren: boolean };
// P7 detail-panel views. Light subsets of the real workflowView/envSpecView payloads —
// every field here is projected by those routes (verified against dao/hierarchies.ts),
// so the heavy columns (specJsonb, checksum, …) are simply ignored, not misdeclared.
// Singular workCenter: an artifact belongs to exactly one. The old plural shape is why
// WorkflowDetail/EnvironmentDetail each grew a "Work Centers" tab — both are deleted in M6.
export type WorkflowView = { workflow: Workflow; workCenter: WorkCenter; environments: EnvironmentSpec[] };

// GET /api/workflows/:id/diagram — re-exported from mission-control-db's workflow-diagram
// DAO (all-string/number shapes, no Dates). This linking surfaced a real drift: the local
// DiagramConnection mirror was missing sourceHandleId, a field the server has shipped
// since the Pilot workflow-diagrams work.
export type {
  Notation, DiagramStep, DiagramConnection, DiagramSpec, WorkflowDiagram,
} from 'mission-control-db';

export type EnvSpecAction = {
  name: string; library: string | null; version: string | null; description: string | null;
  visibility: string | null; inputs: string[]; outputs: string[];
};
export type EnvSpecView = {
  environmentSpec: EnvironmentSpec; workCenter: WorkCenter; workflows: Workflow[];
  actions: EnvSpecAction[];
  actionServers: { name: string; uri: string }[];
  binding: { serverUri: string; allowlisted: boolean } | null;
};
export type PackageScope = 'all' | 'effective';
export type PackagePreview = {
  workCenters: number; workflows: number; environments: number;
  roles: number; grants: number; warnings: string[];
};

// POST /api/work-centers/import — a .WFcenterX package created as a new work-center subtree
// (mode: 'create') or resolved against an existing one (mode: 'merge', P3). Re-exported
// from mission-control-db's package/import.ts (no Dates in these shapes).
export type { ConfigChange, TargetOnlyGrant, ImportReport } from 'mission-control-db';

// Status vocabulary — the DB CHECK and this union now share one source (execution.ts).
export type { RuntimeWorkflowStatus } from 'mission-control-db';
import type { RuntimeWorkflowStatus } from 'mission-control-db';
export type RuntimeWorkflowSummary = {
  id: string; workCenterId: string; runtimeNumber: number; runtimeLabel: string;
  masterName: string; masterOid: string; masterVersion: string; masterState: string;
  status: RuntimeWorkflowStatus; createdByName: string | null; createdByLabel: string | null; createdAt: string;
  queuedAt: string | null; startedAt: string | null; completedAt: string | null;
};
export type RuntimeParameterSpec = { id: string; description: string | null; defaultValue: string; valueType: 'literal' | 'property' };

// Phase 6 (CM monitoring & control) — Dates arrive as strings (guards below).
export type RuntimePresence = 'online' | 'away' | 'offline';
export type { RuntimeStepClaimant, RuntimeActiveStep, RuntimeListFilter, RuntimeStatusCounts } from 'mission-control-db';
import type { RuntimeStepClaimant, RuntimeActiveStep, RuntimeStatusCounts } from 'mission-control-db';
export type RuntimeWorkflowMonitorSummary = RuntimeWorkflowSummary & { activeSteps: RuntimeActiveStep[]; errorText: string | null };
// statusCounts optional on the client type only so pre-counts fixtures/mocks stay valid —
// the server always sends it, and the chips fall back to bare labels when it's absent.
export type RuntimeWorkflowPage = { runtimeWorkflows: RuntimeWorkflowMonitorSummary[]; total: number; page: number; pageSize: number; statusCounts?: RuntimeStatusCounts };
export type RuntimeLiveStep = { id: string; stepOid: string; stepName: string | null; stepType: string; state: string; error: string | null; startedAt: string | null; completedAt: string | null; assignment: { id: string; status: 'offered' | 'claimed'; claimant: RuntimeStepClaimant | null } | null; gateTimer: GateTimer | null };
export type RuntimeTraceEntryView = { stepOid: string | null; stepName: string | null; state: string; error: string | null; at: string };
// Spec 2026-09-06 D6: one row per e-signature attempt (signed or failed). Date → string.
export type StepSignatureView = {
  id: string; stepOid: string; stepName: string;
  signerLoginName: string; signerDisplayName: string | null;
  roleName: string | null; meaning: string | null; decision: string | null;
  outcome: 'signed' | 'failed'; failureCode: string | null; signedAt: string;
};
export type RuntimeWorkflowLiveDetail = { summary: RuntimeWorkflowSummary; steps: RuntimeLiveStep[]; trace: RuntimeTraceEntryView[]; signatures: StepSignatureView[] };
export type WorkCenterPresenceEntry = { userId: string; name: string | null; status: 'online' | 'away'; since: string };

// GET/PUT /api/work-centers/:id/environment-bindings — which Action Server a work center's
// runtime workflows dial for a given environment (by environment_spec.oid). updatedAt is a
// Date on the wire -> string here, same convention as effectiveFrom above.
export type EnvironmentBinding = { environmentOid: string; serverUri: string; updatedAt: string };
export type ControlGrantScope = 'own' | 'any';
export type ControlGrant = {
  sourceWorkCenterId: string; sourceWorkCenterName: string;
  targetWorkCenterId: string; targetWorkCenterName: string;
  scope: ControlGrantScope; createdAt: string;
};
export type ControlGrantList = { outgoing: ControlGrant[]; incoming: ControlGrant[] };

// Phase 7 (CM history log management) — Dates arrive as strings (guards below). The
// final-state union and the trace-entry shape come straight from the package.
export type { RuntimeFinalState as RuntimeHistoryFinalState, TraceEntry as RuntimeHistoryTraceEntry } from 'mission-control-db';
import type { RuntimeFinalState as RuntimeHistoryFinalState, TraceEntry as RuntimeHistoryTraceEntry } from 'mission-control-db';
export type RuntimeHistorySummary = {
  id: string; workflowInstanceId: string | null; workCenterId: string | null; workCenterName: string;
  runtimeNumber: number; runtimeLabel: string; masterName: string; masterOid: string; masterVersion: string; masterState: string;
  finalState: RuntimeHistoryFinalState; startedAt: string | null; finishedAt: string; createdAt: string;
};
export type RuntimeHistoryPage = { history: RuntimeHistorySummary[]; total: number; page: number; pageSize: number };
// Detail deliberately NARROWS the DAO's `trace: unknown` / `stepParams: unknown` — the
// client parses the jsonb payloads it renders, so this stays a local declaration on top of
// the guarded Summary.
export type RuntimeHistoryDetail = RuntimeHistorySummary & {
  startingParams: Record<string, string> | null; trace: RuntimeHistoryTraceEntry[];
  properties: Record<string, string> | null;
  stepParams: Record<string, { inputParameters?: Record<string, string>; outputParameters?: Record<string, string> }> | null;
  stepNames: Record<string, string> | null;
  signatures: StepSignatureView[];
  stepRuns: StepRunView[];
  startedByLoginName: string | null; startedByUserId: string | null;
  userNames: Record<string, string>;
  createdByLabel: string | null; createdByInstanceId: string | null;
  outputs: Array<{ name: string; value: string }> | null;
};
export type StepRunView = {
  id: string; stepInstanceId: string | null; stepOid: string; stepName: string; stepType: string; runNumber: number;
  startedAt: string | null; finishedAt: string; result: 'completed' | 'failed' | 'caught' | 'aborted' | 'stopped' | 'cancelled';
  error: string | null; inputParameters: Record<string, string> | null; outputParameters: Record<string, string> | null;
  performedByLoginName: string | null; performedByKind: 'user' | 'script' | 'action' | 'gate' | 'system';
  nodePath: Array<{ proxyStepOid: string; proxyRun: number; workflowName: string }>;
};
export type RuntimeHistoryListParams = {
  state?: RuntimeHistoryFinalState; search?: string; from?: string; to?: string; page?: number;
  workCenterId?: string; orphans?: boolean;
};

// GET/PUT /api/system-settings (action-matching-mode spec 2026-08-20; widened 2026-09-05 for
// the action-server trust mode + allowlist).
export type { ActionMatchingMode, ActionServerTrust } from 'mission-control-db';
import type { ActionMatchingMode, ActionServerTrust } from 'mission-control-db';
import type { PilotTheme, BrokenWorkCenter, ThemeChainLayer } from 'mission-control-db';
/** `pilotTheme` is optional only for older servers and test mocks; the server always sends it. */
export type SystemSettings = {
  actionMatching: ActionMatchingMode;
  actionServerTrust: ActionServerTrust;
  actionServerAllowlist: string[];
  pilotTheme?: { rev: number; site: PilotTheme };
  /** PUT responses only (spec §11): work centers whose own override the site change broke. */
  pilotThemeBrokenWorkCenters?: BrokenWorkCenter[];
};
export type SystemSettingsPatch = Partial<Omit<SystemSettings, 'pilotTheme' | 'pilotThemeBrokenWorkCenters'>> & { pilotTheme?: PilotTheme };

/** GET/PUT /api/work-centers/:id/pilot-theme (spec 2026-10-09 §8). chain: root first, this last. */
export type WorkCenterThemeView = { rev: number; site: PilotTheme; chain: ThemeChainLayer[]; broken?: BrokenWorkCenter[] };

// CM Runtime pane (spec 2026-08-27). All-string/number shapes — direct re-exports.
export type {
  ActiveRuntimeLeaf, AssignmentCandidate, AssignmentCandidatesView,
  RuntimeWorkflowDiagram, RuntimeWorkflowLiveStates, PilotLiveStep, PilotLiveAssignment, GateTimer,
} from 'mission-control-db';
import type { ActiveRuntimeLeaf, GateTimer } from 'mission-control-db';
export type RuntimeActiveTree = { nodes: WcNode[]; runtimeWorkflows: ActiveRuntimeLeaf[] };

// ── Phase 3: work-center shared state (spec §6) — read-only mirrors of dao/shared-state.ts ──
// Date-free shapes come straight from the barrel; the rest mirror Date → string and are pinned
// by _WireContractGuards below.
export type { ResourceSummary, ResourceProvenance, WcWaiterKind, WorkflowResourceView } from 'mission-control-db';
import type { ResourceSummary, ResourceProvenance, WcWaiterKind, WorkflowResourceView } from 'mission-control-db';
export type SharedResourceHolder = { id: number; instanceId: string; runtimeNumber: number; runtimeLabel: string; masterName: string; stepOid: string; stepName: string | null; amount: number; heldName: string | null; acquiredAt: string };
export type SharedResourceWaiter = { id: number; instanceId: string; runtimeNumber: number; runtimeLabel: string; masterName: string; stepOid: string; stepName: string | null; kind: WcWaiterKind; amount: number | null; granted: boolean; enqueuedAt: string };
export type SharedResourceView = {
  workCenterId: string; name: string; resourceType: string; description: string | null;
  useLimit: number | null; poolNames: string[]; availableNames: string[]; inUse: number;
  summary: ResourceSummary; unaccounted: number | null; ledgerMismatch: boolean; overCommitted: boolean;
  holders: SharedResourceHolder[]; waiters: SharedResourceWaiter[];
  definedBy: ResourceProvenance; orphaned: boolean; updatedAt: string;
};
export type EnvironmentResourcesView = { workCenterId: string; resources: SharedResourceView[]; unregistered: string[] };
export type SharedValuePropertyView = { workCenterId: string; propertyName: string; entryName: string; value: string; annotation: boolean; definedByEnvSpecId: string | null; orphaned: boolean; updatedAt: string; updatedByName: string | null };
export type EnvironmentValuePropertiesView = { workCenterId: string; values: SharedValuePropertyView[]; unregistered: { propertyName: string; entryName: string }[] };
export type InstanceResourcesView = { instanceId: string; runtimeNumber: number; runtimeLabel: string; masterName: string; workflow: WorkflowResourceView[]; environment: SharedResourceView[] };
export type InstanceValuePropertiesView = { instanceId: string; root: Record<string, string>; children: { childOid: string; childName: string | null; values: Record<string, string> }[]; shared: SharedValuePropertyView[] };

// Phase 4b (spec §7.2): the operator writes. `waiterId` on the instance body is a number for an
// environment waiter row and a STRING (the queued step's oid) for a workflow-tier waiter (D16).
export type ResourceVerb = 'release-holder' | 'release' | 'reset' | 'cancel-waiter' | 'clear-sync';
export type ResourceVerbBody = { name: string; holderId?: number; waiterId?: number; amount?: number; poolName?: string };
export type InstanceResourceVerbBody = { resourceKey: string; holderId?: number; waiterId?: number | string; amount?: number; poolName?: string };
export type VerbResponse = { ok: true; summary: string };

// ── Contract drift guards (audit item 2) ────────────────────────────────────────────────
// Compile-time proof that every serialized mirror above still matches the DAO type it
// mirrors, with Date → string. All type-level: nothing here reaches the bundle.
import type {
  RuntimeWorkflowSummary as DbRuntimeWorkflowSummary,
  RuntimeWorkflowMonitorSummary as DbRuntimeWorkflowMonitorSummary,
  RuntimeLiveStep as DbRuntimeLiveStep,
  RuntimeTraceEntryView as DbRuntimeTraceEntryView,
  RuntimeHistorySummary as DbRuntimeHistorySummary,
  StepSignatureView as DbStepSignatureView,
  StepRunView as DbStepRunView,
  RuntimeWorkflowLiveDetail as DbRuntimeWorkflowLiveDetail,
} from 'mission-control-db';
import type { WorkCenterPresenceEntry as DbWorkCenterPresenceEntry } from 'mission-control-db/src/dao/presence';
import type {
  AppUser as DbAppUser, Role as DbRole, WorkCenter as DbWorkCenter,
  WorkCenterView as DbWorkCenterView, UserView as DbUserView, RoleView as DbRoleView,
} from 'mission-control-db';
import type {
  SharedResourceView as DbSharedResourceView,
  EnvironmentResourcesView as DbEnvironmentResourcesView,
  SharedValuePropertyView as DbSharedValuePropertyView,
  EnvironmentValuePropertiesView as DbEnvironmentValuePropertiesView,
  InstanceResourcesView as DbInstanceResourcesView,
  InstanceValuePropertiesView as DbInstanceValuePropertiesView,
} from 'mission-control-db';

// Spec 2026-10-19 §A: the runtimes one runtime created. createdAt is Date → string on the wire.
export type { CreatedRuntimeTarget } from 'mission-control-db';
import type { CreatedRuntimeTarget, CreatedRuntimeRow as DbCreatedRuntimeRow } from 'mission-control-db';
export type CreatedRuntimeRow = {
  runtimeLabel: string;
  workCenterPath: string | null; workflowName: string | null; workflowVersion: string | null; workflowState: string | null;
  createdAt: string | null; state: RuntimeWorkflowStatus | null;
  open: CreatedRuntimeTarget | null;
};
export type CreatedRuntimesPage = { items: CreatedRuntimeRow[]; total: number };

type Serialized<T> = T extends Date ? string
  : T extends (infer U)[] ? Serialized<U>[]
  : T extends object ? { [K in keyof T]: Serialized<T[K]> }
  : T;
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

// Both sides go through Serialized: the local side has no Dates, so for it Serialized is
// just a normalizing flatten — without it, `A & B` vs the flattened mapped type would fail
// the exact-identity Equals even when structurally the same.
export type _WireContractGuards = [
  Expect<Equals<Serialized<CreatedRuntimeRow>, Serialized<DbCreatedRuntimeRow>>>,
  Expect<Equals<Serialized<RuntimeWorkflowSummary>, Serialized<DbRuntimeWorkflowSummary>>>,
  Expect<Equals<Serialized<RuntimeWorkflowMonitorSummary>, Serialized<DbRuntimeWorkflowMonitorSummary>>>,
  Expect<Equals<Serialized<RuntimeLiveStep>, Serialized<DbRuntimeLiveStep>>>,
  Expect<Equals<Serialized<RuntimeTraceEntryView>, Serialized<DbRuntimeTraceEntryView>>>,
  Expect<Equals<Serialized<RuntimeHistorySummary>, Serialized<DbRuntimeHistorySummary>>>,
  Expect<Equals<Serialized<WorkCenterPresenceEntry>, Serialized<DbWorkCenterPresenceEntry>>>,
  Expect<Equals<RuntimePresence, RuntimeStepClaimant['presence']>>,
  Expect<Equals<Serialized<SharedResourceView>, Serialized<DbSharedResourceView>>>,
  Expect<Equals<Serialized<EnvironmentResourcesView>, Serialized<DbEnvironmentResourcesView>>>,
  Expect<Equals<Serialized<SharedValuePropertyView>, Serialized<DbSharedValuePropertyView>>>,
  Expect<Equals<Serialized<EnvironmentValuePropertiesView>, Serialized<DbEnvironmentValuePropertiesView>>>,
  Expect<Equals<Serialized<InstanceResourcesView>, Serialized<DbInstanceResourcesView>>>,
  Expect<Equals<Serialized<InstanceValuePropertiesView>, Serialized<DbInstanceValuePropertiesView>>>,
  // Spec 2026-09-06: the identity/hierarchy mirrors are SUBSETS of the row types (the wire
  // carries whole rows; the UI declares only what it reads), so they are pinned by key set
  // and by the picked fields rather than by whole-type equality.
  Expect<Equals<Serialized<Pick<DbAppUser, keyof AppUser>>, AppUser>>,
  Expect<Equals<Serialized<Pick<DbRole, keyof Role>>, Role>>,
  Expect<Equals<Serialized<Pick<DbWorkCenter, keyof WorkCenter>>, WorkCenter>>,
  Expect<Equals<keyof WorkCenterView, keyof DbWorkCenterView>>,
  // The member row is the full app_user row plus two fields; the local mirror keeps only the
  // AppUser subset, so pin the two extra fields' presence rather than the whole key set.
  Expect<Equals<'missionSystemCommander' | 'roles' extends keyof DbWorkCenterView['users'][number] ? true : false, true>>,
  Expect<Equals<DbWorkCenterView['users'][number]['missionSystemCommander'], boolean>>,
  Expect<Equals<keyof UserView, keyof DbUserView>>,
  Expect<Equals<keyof UserView['workCenters'][number], keyof DbUserView['workCenters'][number]>>,
  Expect<Equals<keyof RoleView, keyof DbRoleView>>,
  Expect<Equals<keyof RoleView['members'][number], keyof DbRoleView['members'][number]>>,
  Expect<Equals<Serialized<StepSignatureView>, Serialized<DbStepSignatureView>>>,
  Expect<Equals<Serialized<StepRunView>, Serialized<DbStepRunView>>>,
  Expect<Equals<keyof RuntimeWorkflowLiveDetail, keyof DbRuntimeWorkflowLiveDetail>>,
];

/** Spec 2026-10-09 §12: POST /api/brand-assets → the stored (cleaned) logo. */
export interface BrandAssetView { id: string; mime: 'image/svg+xml' | 'image/png'; width: number; height: number }
