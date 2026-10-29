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

export type Visibility = 'observable' | 'opaque'

export interface ParameterSpec {
  id: string
  value_type: 'literal' | 'property'
  default_value: string
  description?: string
}

// Output params have no target_property_name in Mission Autopilot — they're set
// by user code. Workflow-execution-only fields are intentionally absent.
export type OutputParameterSpec = ParameterSpec

export interface PropertyEntrySpec {
  name: string
  value: string
}

export interface PropertySpec {
  name: string
  entries: PropertyEntrySpec[]
}

export interface ResourcePropertySpec {
  name: string
  resource_type: string
  description?: string
}

export interface ActionDefinition {
  oid: string
  local_id: string
  version: string
  visibility: Visibility
  description?: string
  inputs: ParameterSpec[]
  outputs: OutputParameterSpec[]
  property_specifications?: PropertySpec[]
  /** States that have user code; the build step expects code/<local_id>/<state>.py for each. */
  code_states: string[]
  /** Optional per-action timeout, applied via PUT /management/v1/actions/{oid}/timeout. */
  timeout_seconds?: number | null
}

export interface EnvironmentDefinition {
  oid: string
  local_id: string
  version: string
  description?: string
  schemaVersion?: string
  action_property_specifications?: PropertySpec[]
  value_property_specifications?: PropertySpec[]
  resource_property_specifications?: ResourcePropertySpec[]
}

export interface ScenarioDefinition {
  /** Absolute path to this scenario's source root, used to resolve code/<action>/<state>.py.
   * Convention: set to dirname(fileURLToPath(import.meta.url)) in the definition file. */
  rootDir: string
  /** Library-level metadata for the .WFenvir wrapper. */
  library: {
    oid: string
    local_id: string
    version: string
  }
  environment: EnvironmentDefinition
  actions: ActionDefinition[]
}

export interface BuildResult {
  envFilePath: string
  codeFiles: Array<{ actionOid: string; actionLocalId: string; state: string; path: string }>
  actionPackages: Array<{ actionOid: string; actionLocalId: string; path: string }>
  actions: ActionDefinition[]
  scenario: ScenarioDefinition
}
