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

import type { Library, Specification, SpecificationState } from '@/types/library'
import { generateOID, WORKER_INTERNAL } from '@/lib/snowflake'
import {
  validateActionLibrary,
  validateEnvironmentLibrary,
  validateStepLibrary,
  validateWorkflowLibrary,
  validateWorkflowSpecification,
} from './schema-validator'
import {
  transformInputParams,
  transformOutputParams,
  transformPropertySpecs,
  transformValueTypeSpecs,
} from './transformers'
import { LEGACY_FORMAT_ERROR, isLegacySchemaVersion } from './legacy-detection'
import { importWorkflowSpecToInternal } from './workflow-importers'
import type { LibraryImportSuccess, ImportError, ImportedSpecification } from './import-types'

/**
 * Imports an Action Library from JSON.
 * Validates the JSON and transforms it to internal format with new UUIDs.
 */
export function importActionLibrary(json: unknown): LibraryImportSuccess | ImportError {
  const validation = validateActionLibrary(json)

  if (!validation.success) {
    console.error('[import] Validation failed:', validation.errors)
    return { error: `Validation failed: ${validation.errors.join(', ')}` }
  }

  const data = validation.data
  const now = Date.now()

  const library: Omit<Library, 'id' | 'userId'> = {
    name: data.local_id,
    entityType: 'action',
    description: data.description ?? null,
    author: null,
    changeHistory: null,
    version: data.version || '1.0.0',
    createdAt: now,
    updatedAt: now,
  }

  const specifications: ImportedSpecification[] = data.action_specifications.map((spec) => {
    const visibility = (spec as unknown as Record<string, unknown>).action_visibility as
      | 'opaque'
      | 'observable'
      | undefined
    return {
      // Preserve the source action OID — a workflow's action_proxy_config.action_oid
      // references this; regenerating it breaks the binding after import.
      id: spec.oid,
      name: spec.local_id,
      description: spec.description ?? null,
      version: spec.version || '1.0.0',
      state: 'Draft' as const,
      data: {
        inputs: transformInputParams(spec.input_parameter_specifications),
        outputs: transformOutputParams(spec.output_parameter_specifications),
        values: transformPropertySpecs(spec.property_specifications),
        ...(visibility ? { actionVisibility: visibility } : {}),
      },
      history: [],
      createdAt: now,
      updatedAt: now,
    }
  })

  const result: LibraryImportSuccess = { library, specifications }

  if (data.child_libraries && data.child_libraries.length > 0) {
    result.childLibraries = []
    for (const childData of data.child_libraries) {
      const childResult = importActionLibrary(childData)
      if ('error' in childResult) return childResult
      result.childLibraries.push(childResult)
    }
  }

  return result
}

/**
 * Imports an Environment Library from JSON.
 * Validates the JSON and transforms it to internal format with new UUIDs.
 */
export function importEnvironmentLibrary(json: unknown): LibraryImportSuccess | ImportError {
  const validation = validateEnvironmentLibrary(json)

  if (!validation.success) {
    console.error('[import] Validation failed:', validation.errors)
    return { error: `Validation failed: ${validation.errors.join(', ')}` }
  }

  const data = validation.data
  const now = Date.now()

  const library: Omit<Library, 'id' | 'userId'> = {
    name: data.local_id,
    entityType: 'environment',
    description: data.description ?? null,
    author: null,
    changeHistory: null,
    version: data.version || '1.0.0',
    createdAt: now,
    updatedAt: now,
  }

  const specifications: ImportedSpecification[] = data.environment_specifications.map((spec) => ({
    // Preserve the source environment OID — a workflow's
    // action_proxy_config.environment_oid references this; regenerating it
    // leaves the runtime with "No server bound for environment <oid>".
    id: spec.oid,
    name: spec.local_id,
    description: spec.description ?? null,
    version: spec.version || '1.0.0',
    state: ((spec as { state?: string }).state as SpecificationState | undefined) ?? 'Draft',
    history: [],
    data: {
      // Store in UI format (snake_case) so EnvironmentDetailView can read it directly
      included_actions: spec.included_actions.map((action) => ({
        action_name: action.action_name,
        action_library: action.action_library,
      })),
      // Store weak-match metadata separately for resolveIncludedActions.
      // The new export shape (matching .WFaction) uses bare oid/version on
      // each entry; older exports used action_oid/action_version. Accept both.
      _importedActionMeta: spec.included_actions
        .map((action) => {
          const oid = action.oid ?? (action as { action_oid?: string }).action_oid
          const version = action.version ?? (action as { action_version?: string }).action_version
          return { action: action, oid, version }
        })
        .filter(({ oid, version }) => oid || version)
        .map(({ action, oid, version }) => ({
          action_name: action.action_name,
          action_library: action.action_library,
          action_oid: oid,
          action_version: version,
        })),
      values: transformPropertySpecs(spec.value_property_specifications),
      actionProperties: transformPropertySpecs(spec.action_property_specifications),
      valueTypes: transformValueTypeSpecs(spec.value_type_specifications),
      resources: spec.resource_property_specifications?.map((res) => ({
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
      })),
      actionServers: spec.action_server_specifications?.map((server) => ({
        id: generateOID(WORKER_INTERNAL),
        name: server.name,
        uri: server.uri,
        description: server.description,
        connectionType: server.connection_type,
        apiKey: server.api_key,
      })),
    },
    createdAt: now,
    updatedAt: now,
  }))

  const result: LibraryImportSuccess = { library, specifications }

  if (data.child_libraries && data.child_libraries.length > 0) {
    result.childLibraries = []
    for (const childData of data.child_libraries) {
      const childResult = importEnvironmentLibrary(childData)
      if ('error' in childResult) return childResult
      result.childLibraries.push(childResult)
    }
  }

  return result
}

/**
 * Imports a Step Library from JSON.
 * Step library specs are complete workflows — mirrors importWorkflowLibrary.
 */
export function importStepLibrary(json: unknown): LibraryImportSuccess | ImportError {
  const validation = validateStepLibrary(json)

  if (!validation.success) {
    console.error('[import] Validation failed:', validation.errors)
    return { error: `Validation failed: ${validation.errors.join(', ')}` }
  }

  const data = validation.data
  const now = Date.now()

  const library: Omit<Library, 'id' | 'userId'> = {
    name: data.local_id,
    entityType: 'step',
    description: data.description ?? null,
    author: null,
    changeHistory: null,
    version: data.version || '1.0.0',
    createdAt: now,
    updatedAt: now,
  }

  const specifications: Omit<Specification, 'id' | 'libraryId'>[] = data.workflow_specifications.map((spec) =>
    importWorkflowSpecToInternal(spec, now),
  )

  const result: LibraryImportSuccess = { library, specifications }

  if (data.child_libraries && data.child_libraries.length > 0) {
    result.childLibraries = []
    for (const childData of data.child_libraries) {
      const childResult = importStepLibrary(childData)
      if ('error' in childResult) return childResult
      result.childLibraries.push(childResult)
    }
  }

  return result
}

/**
 * Imports a Workflow Library from JSON.
 * Validates the JSON and transforms it to internal format with new UUIDs.
 * Falls back to treating the JSON as a single workflow spec if library validation fails.
 */
export function importWorkflowLibrary(json: unknown): LibraryImportSuccess | ImportError {
  // Reject pre-v4.0 files immediately (version-based check only)
  if (isLegacySchemaVersion(json)) {
    return { error: LEGACY_FORMAT_ERROR }
  }

  const validation = validateWorkflowLibrary(json)

  if (!validation.success) {
    // Fallback: try as a single workflow specification and wrap as a library
    const specValidation = validateWorkflowSpecification(json)
    if (specValidation.success) {
      const spec = specValidation.data
      const now = Date.now()

      return {
        library: {
          name: spec.local_id,
          entityType: 'workflow',
          description: spec.description ?? null,
          author: null,
          changeHistory: null,
          version: spec.version || '1.0.0',
          createdAt: now,
          updatedAt: now,
        },
        specifications: [importWorkflowSpecToInternal(spec, now)],
      }
    }

    console.error('[import] Workflow library validation failed (also tried as single spec):', validation.errors)
    return { error: `Validation failed: ${validation.errors.join(', ')}` }
  }

  const data = validation.data
  const now = Date.now()

  const library: Omit<Library, 'id' | 'userId'> = {
    name: data.local_id,
    entityType: 'workflow',
    description: data.description ?? null,
    author: null,
    changeHistory: null,
    version: data.version || '1.0.0',
    createdAt: now,
    updatedAt: now,
  }

  const specifications: Omit<Specification, 'id' | 'libraryId'>[] = data.workflow_specifications.map((spec) =>
    importWorkflowSpecToInternal(spec, now),
  )

  const result: LibraryImportSuccess = { library, specifications }

  if (data.child_libraries && data.child_libraries.length > 0) {
    result.childLibraries = []
    for (const childData of data.child_libraries) {
      const childResult = importWorkflowLibrary(childData)
      if ('error' in childResult) return childResult
      result.childLibraries.push(childResult)
    }
  }

  return result
}
