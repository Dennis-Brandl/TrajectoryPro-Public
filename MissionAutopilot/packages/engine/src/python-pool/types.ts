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

/**
 * types.ts — JSON protocol types for the Node.js <-> Python sidecar communication.
 *
 * These interfaces match the ExecutionEngineSpec.md §2.2 JSON protocol exactly.
 * Requests flow from PythonWorker -> sandbox_runner.py via stdin.
 * Responses flow from sandbox_runner.py -> PythonWorker via stdout.
 */

/**
 * Request sent to the Python sidecar worker over stdin (newline-delimited JSON).
 */
export interface SidecarRequest {
  request_id: string
  action_oid: string
  action_name: string
  state: string
  source_code: string
  inputs: Record<string, string>
  outputs: Record<string, string>
  environment_action_properties: Record<string, Record<string, string>>
  action_properties: Record<string, Record<string, string>>
  timeout_ms: number
}

/**
 * Response received from the Python sidecar worker over stdout (newline-delimited JSON).
 */
export interface SidecarResponse {
  request_id: string
  success: boolean
  outputs: Record<string, string>
  return_value: boolean | null
  execution_time_ms: number
  stdout_capture: string
  stderr_capture: string
  // Error fields (present when success is false)
  error?: string
  error_type?:
    | 'SYNTAX_ERROR'
    | 'RUNTIME_ERROR'
    | 'TIMEOUT'
    | 'WORKER_CRASH'
    | 'PROPERTY_WRITE_ERROR'
  traceback?: string
  property_mutations?: Array<{ spec_name: string; entry_name: string; value: string }>
  /**
   * Commands requested by user code via trajectory.request_command().
   * Sidecar validates command name; engine validates per-state legality and
   * dispatches the first entry after the executor returns.
   */
  requested_commands?: Array<{ command: string; reason: string | null }>
}
