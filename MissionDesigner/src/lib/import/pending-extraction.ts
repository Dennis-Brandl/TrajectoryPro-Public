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

import type { MasterWorkflowSpecification, MasterEnvironmentSpecification } from '@/lib/packageFormat/export-types'
import { generateOID, WORKER_INTERNAL } from '@/lib/snowflake'
import {
  transformInputParams,
  transformOutputParams,
  transformPropertySpecs,
  transformResourcePropertySpecs,
  transformValueTypeSpecs,
} from './transformers'
import type { PendingEnvironmentSpec, WorkflowImportSuccess } from './import-types'

/**
 * Extracts pending environment specs from a workflow spec into internal camelCase format.
 */
export function extractPendingEnvSpecs(spec: MasterWorkflowSpecification): PendingEnvironmentSpec[] | undefined {
  if (!spec.environment_specifications || spec.environment_specifications.length === 0) {
    return undefined
  }

  return spec.environment_specifications.map((envSpec: MasterEnvironmentSpecification) => ({
    name: envSpec.local_id,
    description: envSpec.description ?? null,
    libraryName: envSpec.library_name,
    version: envSpec.version,
    includedActions: envSpec.included_actions.map((action) => ({
      actionName: action.action_name,
      actionLibrary: action.action_library,
    })),
    values: transformPropertySpecs(envSpec.value_property_specifications) || [],
    actionProperties: transformPropertySpecs(envSpec.action_property_specifications) || [],
    valueTypes: transformValueTypeSpecs(envSpec.value_type_specifications) || [],
    resources:
      envSpec.resource_property_specifications?.map((res) => ({
        id: generateOID(WORKER_INTERNAL),
        name: res.name,
        description: res.description,
        resourceType:
          res.resource_type === 'binary exclusive use'
            ? 'Single Use'
            : res.resource_type === 'countable use with pool limits'
              ? 'Count Limited'
              : res.resource_type === 'named pool'
                ? 'Named'
                : res.resource_type === 'sync'
                  ? 'Sync'
                  : 'Shared Use',
        count: res.resource_type === 'named pool' ? (res.names?.length ?? 0) : (res.use_limit ?? 1),
        ...(res.names && res.names.length > 0 ? { names: res.names } : {}),
      })) || [],
    actionServers:
      envSpec.action_server_specifications?.map((server) => ({
        id: generateOID(WORKER_INTERNAL),
        name: server.name,
        uri: server.uri,
        description: server.description,
        connectionType: server.connection_type,
        apiKey: server.api_key,
      })) || [],
  }))
}

/**
 * Populates workflow-level properties on a WorkflowImportSuccess result
 * from the spec's starting/output/value/resource specifications.
 */
export function populateWorkflowLevelProps(result: WorkflowImportSuccess, spec: MasterWorkflowSpecification): void {
  result.workflowInputs = transformInputParams(spec.starting_parameter_specifications) || []
  result.workflowOutputs = transformOutputParams(spec.output_parameter_specifications) || []
  result.workflowValues = transformPropertySpecs(spec.value_property_specifications) || []
  result.workflowResources = transformResourcePropertySpecs(spec.resource_property_specifications) || []
  result.workflowTrySpecifications = spec.try_specifications ?? []
  if (spec.viewport) {
    result.viewport = spec.viewport
  }
}
