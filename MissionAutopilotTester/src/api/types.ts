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

export interface Connection {
  id: string
  url: string
  name?: string
  apiKey?: string
  createdAt: string
}

export type ActionVisibility = 'observable' | 'opaque'

/**
 * Wire shape per RESTProtocolSpec.md § 2.2. The server's
 * normalizeParameterSpec collapses heterogeneous stored shapes onto this
 * canonical contract — never rely on fields outside this interface.
 */
export interface InputParameterSpec {
  name: string
  description?: string
  default_value?: string
  json_schema?: string | null
}

export interface OutputParameterSpec {
  name: string
  description?: string
}

export interface ActionCapability {
  action_oid: string
  action_name: string
  action_state: 'Draft' | 'InTest' | 'InReview' | 'Approved' | 'Effective' | 'Superseded' | 'Obsolete'
  /** Alias of action_name — kept for compat with invoke call sites */
  local_id: string
  version: string
  description?: string
  visibility: ActionVisibility
  input_parameters: InputParameterSpec[]
  output_parameters: OutputParameterSpec[]
  supported_commands: string[]
}

export interface ActionPropertyEntry {
  name: string
  value: string
}

export interface EnvironmentCapability {
  environment_oid: string
  environment_name: string
  environment_state: 'Draft' | 'InTest' | 'InReview' | 'Approved' | 'Effective' | 'Superseded' | 'Obsolete'
  action_properties: Array<{
    name: string
    oid?: string
    description?: string
    entries: ActionPropertyEntry[]
  }>
  actions: ActionCapability[]
}

export interface CapabilitiesResponse {
  data: { environments: EnvironmentCapability[] }
  meta: { total_environments: number; total_actions: number }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly body: string
  ) {
    super(`HTTP ${status} ${statusText}`)
    this.name = 'ApiError'
  }
}

// ============================================================
// Invoke / Instance — request and response shapes
// ============================================================

export interface InvokeInputParameter {
  name: string
  value: string
}

/**
 * Runtime key-value pair as stored on an instance row and echoed by the
 * server in `GET /instances/:id` (instance.inputs, instance.outputs) and
 * in the SSE `output` event. The server uses `key` here — distinct from the
 * invoke-request shape, which uses `name` (matching the action's input
 * parameter spec). See `packages/server/src/__tests__/scenario-warehouse.test.ts`
 * `awaitTerminal()` (~ln 135) for the canonical wire shape.
 */
export interface RuntimeParameterPair {
  key: string
  value: string
}

export interface InvokeRequestBody {
  environment_oid: string
  workflow_instance_id: string
  step_instance_id: string
  step_oid: string
  input_parameters: InvokeInputParameter[]
  timeout_ms?: number
  /**
   * Test/dev affordance accepted by the Action Container server.
   * Override entries in the env's `action_property_specifications` for this
   * single invocation. Shape: `Record<spec_name, Record<entry_name, value>>`.
   *
   * Example: `{ SIMULATION_MODE: { Value: 'true' } }` flips the env-level
   * SIMULATION_MODE.Value to 'true' just for this run's state code.
   */
  action_property_overrides?: Record<string, Record<string, string>>
}

export interface InvokeResponse {
  data: { instance_id: string }
  meta: Record<string, unknown>
}

export interface InstanceStateSummary {
  current: string
  previous: string | null
  entered_at: string
}

export interface Instance {
  instance_id: string
  action_oid: string
  environment_oid: string
  workflow_instance_id: string
  step_instance_id: string
  step_oid: string
  visibility: ActionVisibility
  state: InstanceStateSummary
  inputs: RuntimeParameterPair[]
  outputs: RuntimeParameterPair[]
  created_at: string
  started_at: string | null
  completed_at: string | null
  error: string | null
}

export interface InstanceResponse {
  data: Instance
  meta: Record<string, unknown>
}

// ============================================================
// Commands
// ============================================================

export type Command = 'PAUSE' | 'RESUME' | 'HOLD' | 'UNHOLD' | 'ABORT' | 'STOP' | 'CLEAR'

export interface SendCommandRequest {
  command: Command
}

export interface SendCommandResponse {
  data: {
    instance_id: string
    command: Command
    accepted: true
  }
  meta: Record<string, unknown>
}

// ============================================================
// SSE wire events — shapes parsed off the EventSource stream
// ============================================================

export type SseEventType = 'state_change' | 'output' | 'log' | 'heartbeat'

export interface StateChangeEvent {
  instance_id: string
  state: string
  previous_state: string | null
  timestamp: string
}

export interface OutputEvent {
  instance_id: string
  outputs: RuntimeParameterPair[]
  timestamp: string
}

export interface LogEvent {
  instance_id: string
  stream: 'stdout' | 'stderr'
  message: string
  timestamp: string
}

export interface HeartbeatEvent {
  timestamp: string
}

export type SseEventWire =
  | { id: number; type: 'state_change'; data: StateChangeEvent }
  | { id: number; type: 'output'; data: OutputEvent }
  | { id: number; type: 'log'; data: LogEvent }
  | { id: number; type: 'heartbeat'; data: HeartbeatEvent }

// ============================================================
// Live state — reduced view of an instance from REST seed + SSE
// ============================================================

export interface StateEntry {
  state: string
  entered_at: string
  /** Set when this entry is superseded by a newer state. Undefined while current. */
  duration_ms?: number
}

export interface InstanceLiveState {
  instance_id: string
  visibility: ActionVisibility
  current_state: string
  state_history: StateEntry[]
  outputs: Record<string, string>
  /** Most recent stderr message from a `log` event. */
  latest_error?: string
  /** Heuristic traceback extracted from `latest_error` (lines starting with "Traceback"). */
  latest_traceback?: string
  /** Terminal error from the initial REST seed (instance.error). */
  terminal_error: string | null
  terminal: boolean
  /** Highest SSE event id seen — used to detect resumption gaps. */
  last_event_id: number
}
