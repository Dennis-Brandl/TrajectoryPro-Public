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

// ============================================================
// Mission Autopilot — Console TypeScript interfaces
// Derived from /management/v1/ API response shapes
// ============================================================

// ---- Dashboard ----

export interface ContainerInfo {
  uptime_seconds: number
  started_at: string
  node_version: string
  python_version: string | null
  db_name: string | null
  db_size_bytes: number | null
  memory_rss_bytes: number
}

export interface PythonPoolInfo {
  size: number
  idle: number
  busy: number
  queued: number
}

export interface EnvironmentsInfo {
  total_count: number
  total_actions: number
}

export interface InstancesInfo {
  active_count: number
  completed_today: number
  aborted_today: number
}

export interface LogInfo {
  total_entries: number
  max_entries: number
  oldest_entry_at: string | null
}

export interface RecentLogEntry {
  id: number
  action_name: string
  environment_name: string
  final_status: FinalStatus
  duration_ms: number
  completed_at: string
}

export interface DashboardResponse {
  container: ContainerInfo
  python_pool: PythonPoolInfo
  environments: EnvironmentsInfo
  instances: InstancesInfo
  log: LogInfo
  recent_log_entries: RecentLogEntry[]
}

// ---- Server info ----

/**
 * Returned by GET /management/v1/server-info — the externally-reachable REST
 * URL of THIS container. Used by the console top bar so workflow authors
 * can copy the right URL into env.action_server_specifications, rather than
 * the console's own URL (which differs when the console runs under Vite or
 * behind a reverse proxy).
 */
export interface ServerInfoResponse {
  /** Base URL the REST API is reachable at, without trailing slash. */
  rest_base_url: string
  /** Conventional protocol path the runtime appends, e.g. "/trajectory/v1/". */
  protocol_path: string
  /** Numeric port the server is listening on. */
  port: number
  /**
   * Address the Mission Engine and Mission Commander use to reach this server
   * from inside the Docker network (where `localhost` is a different
   * machine), or `null` in standalone/dev runs with no fleet network.
   */
  fleet_base_url: string | null
}

// ---- Upload ----

export interface ImportedItem {
  type: 'environment' | 'action'
  oid: string
  local_id: string
  version: string
  actions_count?: number
  status: 'created' | 'updated'
  /** Environments only: the oid this environment was re-keyed from (same name, new oid). */
  rekeyed_from?: string | null
}

/** Per-action outcome of the reconciliation, by action name. */
export interface UploadDiff {
  added: string[]
  removed: string[]
  modified: string[]
  rekeyed: string[]
  orphaned: string[]
  signature_changed: string[]
}

export interface ImportError {
  filename: string
  error: string
}

export interface UploadResult {
  imported: ImportedItem[]
  errors: ImportError[]
  diff?: UploadDiff
}

// ---- Environments ----

export interface EnvironmentSummary {
  oid: string
  local_id: string
  version: string
  description: string | null
  last_modified_date: string | null
  imported_at: string
  action_count: number
  action_property_specifications: ActionPropertySpec[]
  value_property_specifications: ValuePropertySpec[]
  resource_property_specifications: ResourcePropertySpec[]
}

export interface EnvironmentsResponse {
  environments: EnvironmentSummary[]
}

export interface PropertyEntry {
  name: string
  value: string
}

export interface ActionPropertySpec {
  name: string
  entries: PropertyEntry[]
}

/** One value change for PUT /environments/:oid/properties or PUT /actions/:oid/properties. */
export interface PropertyEdit {
  property: string
  entry: string
  value: string
}

export interface ValuePropertySpec {
  name: string
  entries: PropertyEntry[]
}

export interface ResourcePropertySpec {
  name: string
  resource_type: string
  description: string | null
}

export interface ActionSummaryInEnvironment {
  oid: string
  local_id: string
  version: string
  action_visibility: 'observable' | 'opaque'
  input_param_count: number
  output_param_count: number
  states_with_code: string[]
  signature_change: SignatureChange | null
  orphaned_at: string | null
}

export interface EnvironmentDetail {
  oid: string
  local_id: string
  version: string
  description: string | null
  last_modified_date: string | null
  schema_version: string
  imported_at: string
  source_filename: string | null
  action_property_specifications: ActionPropertySpec[]
  value_property_specifications: ValuePropertySpec[]
  resource_property_specifications: ResourcePropertySpec[]
  actions: ActionSummaryInEnvironment[]
}

export interface DeleteEnvironmentResult {
  deleted: boolean
  environment_oid: string
  actions_removed: number
  code_versions_removed: number
}

// ---- Actions ----

export interface InputParameterSpec {
  id: string
  default_value: string
  value_type: string
  description: string | null
}

export interface OutputParameterSpec {
  id: string
  default_value: string
  value_type: string
  target_property_name: string | null
  target_entry_name: string | null
  description: string | null
}

export interface CodeSummary {
  states_with_code: string[]
  total_versions: number
  last_code_update: string | null
}

/**
 * Left on an action by an environment re-import when the action already has
 * code and its input/output signature differs from the one the code was
 * written against. `changes` are ready-to-show lines; the baseline is the
 * signature at the time the flag was first raised.
 */
export interface SignatureChange {
  flagged_at: string
  baseline_input_parameter_specifications: InputParameterSpec[]
  baseline_output_parameter_specifications: OutputParameterSpec[]
  changes: string[]
}

export interface DeleteActionResult {
  deleted: boolean
  action_oid: string
  code_versions_removed: number
  instances_removed: number
}

export interface ActionDetail {
  oid: string
  local_id: string
  version: string
  description: string | null
  environment_oid: string
  environment_name: string
  action_visibility: 'observable' | 'opaque'
  timeout_seconds: number | null
  input_parameter_specifications: InputParameterSpec[]
  output_parameter_specifications: OutputParameterSpec[]
  property_specifications: ActionPropertySpec[]
  code_summary: CodeSummary
  signature_change: SignatureChange | null
  /** Set when the last import of the environment no longer contained this action. */
  orphaned_at: string | null
}

// ---- Code Versions ----

export interface CodeVersionSummary {
  id: string
  version_number: number
  is_active: boolean
  created_at: string
  description: string | null
}

export interface CodeVersionsResponse {
  action_oid: string
  state: string
  versions: CodeVersionSummary[]
}

export interface CodeVersion {
  id: string
  action_oid: string
  state: string
  version_number: number
  is_active: boolean
  source_code: string
  created_at: string
  description: string | null
}

export interface SaveCodeResult {
  id: string
  version_number: number
  is_active: boolean
  created_at: string
}

export interface ActivateVersionResult {
  id: string
  version_number: number
  is_active: boolean
  activated_at: string
}

export interface DeleteVersionResult {
  deleted: boolean
  id: string
}

export interface ClearCodeResult {
  deleted_version_count: number
}

export interface CodeTestResult {
  success: boolean
  outputs?: Record<string, string>
  return_value?: boolean | null
  error?: string
  error_type?: string
  execution_time_ms: number
  stdout: string
  stderr: string
}

// ---- Instances ----

export type FinalStatus = 'COMPLETED' | 'ABORTED' | 'STOPPED'

export interface ActiveInstance {
  runtime_action_instance_id: string
  action_oid: string
  action_name: string
  environment_name: string
  state: string
  workflow_instance_id: string
  created_at: string
  states_completed: string[]
  current_state_duration_ms: number
}

export interface ActiveInstancesResponse {
  instances: ActiveInstance[]
  total_count: number
}

export interface HistoryInstance {
  runtime_action_instance_id: string
  action_oid: string
  action_name: string
  environment_oid: string
  environment_name: string
  state: string
  started_at: string
  completed_at: string | null
}

export interface HistoryInstancesResponse {
  instances: HistoryInstance[]
  total: number
}

export interface StateHistoryEntry {
  state: string
  timestamp: string
}

export interface PinnedCodeVersion {
  state: string
  code_version_id: string
}

export interface InstanceParameter {
  key: string
  value: string
}

export interface InstanceDetail {
  runtime_action_instance_id: string
  action_oid: string
  action_name: string
  environment_oid: string
  environment_name: string
  visibility: 'observable' | 'opaque'
  state: string
  workflow_instance_id: string
  step_oid: string
  input_parameters: InstanceParameter[]
  output_parameters: InstanceParameter[]
  pinned_code_versions: PinnedCodeVersion[]
  state_history: StateHistoryEntry[]
  created_at: string
  started_at: string
}

// ---- Execution Log ----

export interface StateExecution {
  state: string
  had_code: boolean
  code_version_number: number | null
  entered_at: string
  exited_at: string | null
  duration_ms: number | null
}

export interface LogEntry {
  id: number
  runtime_action_instance_id: string
  action_oid: string
  action_name: string
  environment_oid: string
  environment_name: string
  workflow_instance_id: string | null
  input_parameters: InstanceParameter[]
  output_parameters: InstanceParameter[]
  states_executed: StateExecution[]
  started_at: string
  completed_at: string
  duration_ms: number
  final_status: FinalStatus
}

export type LogEntryDetail = LogEntry

export interface LogPagination {
  page: number
  page_size: number
  total_entries: number
  total_pages: number
}

export interface LogConfig {
  max_entries: number
  current_entries: number
  oldest_entry_at: string | null
}

export interface LogEntriesResponse {
  entries: LogEntry[]
  pagination: LogPagination
  log_config: LogConfig
}

export interface LogQueryParams {
  page?: number
  page_size?: number
  action_name?: string
  environment_oid?: string
  status?: FinalStatus
  from?: string
  to?: string
}

// ---- Settings ----

export interface SettingItem {
  key: string
  value: string
  default_value: string
  description: string
  value_type: string
}

export interface SettingsResponse {
  settings: SettingItem[]
}

export type SettingsMap = Record<string, string>

export interface UpdateSettingResult {
  key: string
  value: string
  previous_value: string
  applied: boolean
}

// ---- Import/Export ----

export interface ImportCodeResult {
  action_oid: string
  imported_states: string[]
  skipped_states: string[]
}

export interface ImportSnapshotResult {
  environments_imported: number
  actions_imported: number
  code_files_imported: number
  settings_imported: number
}
