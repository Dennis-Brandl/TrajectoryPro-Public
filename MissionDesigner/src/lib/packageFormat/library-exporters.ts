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

import { pickLibraryByName } from '@/lib/global-team'
import JSZip from 'jszip'
import type { Library, Specification } from '@/types/library'
import {
  type LibraryWithChildren,
  type MasterActionLibrary,
  type MasterActionSpecification,
  type MasterEnvironmentLibrary,
  type MasterEnvironmentSpecification,
  type MasterWorkflowStepLibrary,
  type ResourcePropertySpecification,
} from './export-types'
import { libraryToManagedElement, specToManagedElement } from './entity-converters'
import {
  extractInputParams,
  extractOutputParams,
  extractPropertySpecs,
  extractActionPropertySpecs,
  extractValueTypeSpecs,
} from './parameter-extractors'
import { exportWorkflowSpec } from './workflow-exporters'

/**
 * Options controlling environment-spec emission.
 */
export interface EnvExportOptions {
  /**
   * Emit value_type_specifications. Default FALSE — Value Types are authoring
   * templates the runtime has no use for, so they stay out of .WFenvirX, canvas
   * .WFmaster JSON and BatchML. The Designer library builders (.WFenvirLibX /
   * .WFlibX / .WFstepLibX) and the environments/ files inside a .WFmasterX pass
   * true, so that importing the package recreates the environment. The runtime
   * side ignores the key.
   */
  includeValueTypes?: boolean

  /** GATE follow-up item 5: an out-array the exporter pushes every gate-binding warning into
   *  (rule-4 ambiguity — the exporter picked the first declaring environment). The caller
   *  decides how to surface them; the console line stays for the server round-trip export,
   *  which has no other channel back to the browser. */
  warnings?: string[]
}

// =============================================================================
// Library Export Functions
// =============================================================================

/**
 * Export an Action Library to Trajectory schema format.
 */
export function exportActionLibrary(
  library: Library,
  specifications: Specification[],
  children?: LibraryWithChildren[],
): MasterActionLibrary {
  const result: MasterActionLibrary = {
    ...libraryToManagedElement(library),
    action_specifications: specifications.map((spec) => ({
      ...specToManagedElement(spec),
      input_parameter_specifications: extractInputParams(spec.data),
      output_parameter_specifications: extractOutputParams(spec.data),
      property_specifications: extractPropertySpecs(spec.data),
      action_visibility: (spec.data.actionVisibility as 'opaque' | 'observable') || 'opaque',
    })),
  }

  if (children && children.length > 0) {
    result.child_libraries = children.map((child) =>
      exportActionLibrary(child.library, child.specifications, child.children),
    )
  }

  return result
}

const RESOURCE_TYPE_MAP: Record<string, ResourcePropertySpecification['resource_type']> = {
  'Single Use': 'binary exclusive use',
  'Shared Use': 'binary shared use with pool limits',
  'Count Limited': 'countable use with pool limits',
  Named: 'named pool',
  Sync: 'sync',
}

function mapResourceType(type: string): ResourcePropertySpecification['resource_type'] {
  return RESOURCE_TYPE_MAP[type] ?? (type as ResourcePropertySpecification['resource_type'])
}

interface ResolvedActionBody {
  localId?: string
  oid?: string
  description?: string
  version?: string
  lastModifiedDate?: string
  visibility?: 'opaque' | 'observable'
  inputs?: ReturnType<typeof extractInputParams>
  outputs?: ReturnType<typeof extractOutputParams>
  properties?: ReturnType<typeof extractPropertySpecs>
}

/**
 * Resolves an `IncludedAction` reference to the source action specification's
 * managed-element fields and parameter specs, used to inline the action body
 * into environment exports. Returns an empty object when the action can't be
 * resolved (no library context, library not found, action not found) — callers
 * tolerate that and fall back to refs-only.
 */
function resolveActionBody(
  actionLibrary: string,
  actionName: string,
  allLibraries?: Library[],
  allSpecsByLibrary?: Map<string, Specification[]>,
  preferTeamId?: string | null,
): ResolvedActionBody {
  if (!allLibraries || !allSpecsByLibrary) return {}
  const lib = pickLibraryByName(allLibraries, actionLibrary, 'action', preferTeamId)
  if (!lib) return {}
  const specs = allSpecsByLibrary.get(lib.id) || []
  const actionSpec = specs.find((s) => s.name === actionName)
  if (!actionSpec) return {}
  return {
    localId: actionSpec.name,
    oid: actionSpec.id,
    description: actionSpec.description ?? undefined,
    version: actionSpec.version || '1.0.0',
    lastModifiedDate: new Date(actionSpec.updatedAt).toISOString(),
    visibility: (actionSpec.data.actionVisibility as 'opaque' | 'observable') || 'opaque',
    inputs: extractInputParams(actionSpec.data),
    outputs: extractOutputParams(actionSpec.data),
    properties: extractPropertySpecs(actionSpec.data),
  }
}

/**
 * Exports a single environment specification to Trajectory schema format.
 *
 * Handles both UI storage format (included_actions, resources, values) and
 * import storage format (includedActions, resourcePropertySpecs).
 *
 * When `allLibraries` and `allSpecsByLibrary` are provided, each entry in
 * `included_actions[]` is inlined with its action body — the environment is
 * the runtime contract, so it must be self-contained for downstream consumers
 * (runtime, action server) that don't read the original action library.
 */
export function exportEnvironmentSpec(
  spec: Specification,
  libraryName?: string,
  allLibraries?: Library[],
  allSpecsByLibrary?: Map<string, Specification[]>,
  libraryOid?: string,
  opts?: EnvExportOptions,
): MasterEnvironmentSpecification {
  const data = spec.data

  // Handle both camelCase (from import) and snake_case (from UI) action formats
  const rawActions = (data.included_actions ?? data.includedActions) as
    | Array<{
        action_name?: string
        action_library?: string
        actionName?: string
        actionLibrary?: string
      }>
    | undefined

  // Handle resource formats: UI stores as 'resources' (ResourceSpec[]), import stores as 'resourcePropertySpecs'
  const uiResources = data.resources as
    | Array<{
        name: string
        resourceType: string
        count: number
        description?: string
        names?: string[]
      }>
    | undefined
  const importResources = (data.resourcePropertySpecs ?? data.resource_property_specifications) as
    | Array<{
        name: string
        resourceType: string
        useLimit?: number
        description?: string
        names?: string[]
      }>
    | undefined

  let resourceSpecs: ResourcePropertySpecification[] | undefined
  if (uiResources && uiResources.length > 0) {
    resourceSpecs = uiResources.map((res) => ({
      name: res.name,
      resource_type: mapResourceType(res.resourceType),
      scope: 'environment' as const,
      use_limit: res.count > 1 ? res.count : undefined,
      description: res.description,
      ...(res.names && res.names.length > 0 ? { names: res.names } : {}),
    }))
  } else if (importResources && importResources.length > 0) {
    resourceSpecs = importResources.map((res) => ({
      name: res.name,
      resource_type: mapResourceType(res.resourceType),
      scope: 'environment' as const,
      use_limit: res.useLimit,
      description: res.description,
      ...(res.names && res.names.length > 0 ? { names: res.names } : {}),
    }))
  }

  // Handle action servers
  const actionServers = data.actionServers as
    | Array<{ name: string; uri: string; description?: string; connectionType: string; apiKey?: string }>
    | undefined

  const actionServerSpecs =
    actionServers && actionServers.length > 0
      ? actionServers.map((server) => ({
          name: server.name,
          uri: server.uri,
          description: server.description,
          connection_type: server.connectionType as 'REST',
          api_key: server.apiKey,
        }))
      : undefined

  const valueTypeSpecs = opts?.includeValueTypes ? extractValueTypeSpecs(data) : undefined

  return {
    ...specToManagedElement(spec),
    ...(libraryName ? { library_name: libraryName } : {}),
    ...(libraryOid ? { library_oid: libraryOid } : {}),
    state: spec.state,
    included_actions:
      rawActions?.map((action) => {
        const name = action.action_name ?? action.actionName ?? ''
        const lib = action.action_library ?? action.actionLibrary ?? ''
        // Same rule as the editor: the environment's own team wins a name clash (spec 2026-10-12 U4).
        const envTeamId = allLibraries?.find((l) => l.id === spec.libraryId)?.teamId
        const resolved = resolveActionBody(lib, name, allLibraries, allSpecsByLibrary, envTeamId)
        // When the action resolves, inline the full MasterActionSpecification
        // shape (same field names as .WFaction). When it doesn't, emit
        // refs-only — consumers can detect the unresolved state by absence
        // of `oid`.
        return {
          action_library: lib,
          action_name: name,
          ...(resolved.localId !== undefined ? { local_id: resolved.localId } : {}),
          ...(resolved.oid !== undefined ? { oid: resolved.oid } : {}),
          ...(resolved.description !== undefined ? { description: resolved.description } : {}),
          ...(resolved.version !== undefined ? { version: resolved.version } : {}),
          ...(resolved.lastModifiedDate !== undefined ? { last_modified_date: resolved.lastModifiedDate } : {}),
          ...(resolved.inputs ? { input_parameter_specifications: resolved.inputs } : {}),
          ...(resolved.outputs ? { output_parameter_specifications: resolved.outputs } : {}),
          ...(resolved.properties ? { property_specifications: resolved.properties } : {}),
          ...(resolved.visibility !== undefined ? { action_visibility: resolved.visibility } : {}),
        }
      }) ?? [],
    value_property_specifications: extractPropertySpecs(data),
    action_property_specifications: extractActionPropertySpecs(data),
    ...(valueTypeSpecs ? { value_type_specifications: valueTypeSpecs } : {}),
    resource_property_specifications: resourceSpecs,
    action_server_specifications: actionServerSpecs,
  }
}

/**
 * Export an Environment Library to Trajectory schema format.
 *
 * When `allLibraries` and `allSpecsByLibrary` are provided, each spec's
 * `included_actions[]` are inlined with their full action body so the
 * environment is self-contained at runtime.
 */
export function exportEnvironmentLibrary(
  library: Library,
  specifications: Specification[],
  children?: LibraryWithChildren[],
  allLibraries?: Library[],
  allSpecsByLibrary?: Map<string, Specification[]>,
  opts?: EnvExportOptions,
): MasterEnvironmentLibrary {
  const result: MasterEnvironmentLibrary = {
    ...libraryToManagedElement(library),
    environment_specifications: specifications.map((spec) =>
      exportEnvironmentSpec(spec, library.name, allLibraries, allSpecsByLibrary, library.id, opts),
    ),
  }

  if (children && children.length > 0) {
    result.child_libraries = children.map((child) =>
      exportEnvironmentLibrary(
        child.library,
        child.specifications,
        child.children,
        allLibraries,
        allSpecsByLibrary,
        opts,
      ),
    )
  }

  return result
}

/**
 * Export a Step Library to Trajectory schema format.
 * Step library specs are complete workflows — mirrors exportWorkflowLibrary.
 */
export function exportStepLibrary(
  library: Library,
  specifications: Specification[],
  children?: LibraryWithChildren[],
  allSpecsByLibrary?: Map<string, Specification[]>,
  allLibraries?: Library[],
  opts?: EnvExportOptions,
): MasterWorkflowStepLibrary {
  // Collect all specs across all libraries for child workflow resolution
  const allSpecs: Specification[] = []
  if (allSpecsByLibrary) {
    for (const specs of allSpecsByLibrary.values()) {
      allSpecs.push(...specs)
    }
  }

  // Only export top-level specs (those without a parentSpecificationId)
  const topLevelSpecs = specifications.filter((spec) => {
    const data = spec.data as { parentSpecificationId?: string } | null
    return !data?.parentSpecificationId
  })

  const result: MasterWorkflowStepLibrary = {
    ...libraryToManagedElement(library),
    workflow_specifications: topLevelSpecs.map((spec) =>
      exportWorkflowSpec(
        spec,
        allSpecs.length > 0 ? allSpecs : specifications,
        allLibraries,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        opts,
      ),
    ),
  }

  if (children && children.length > 0) {
    result.child_libraries = children.map((child) =>
      exportStepLibrary(child.library, child.specifications, child.children, allSpecsByLibrary, allLibraries, opts),
    )
  }

  return result
}

// =============================================================================
// Single-Environment Package Export
// =============================================================================

/**
 * Builds a single-environment `.WFenvirX` ZIP package.
 *
 * Package shape:
 * - `{EnvName}.WFenvir`            — the env spec JSON (no library wrapper)
 * - `actions/{ActionName}.WFaction` — each included action spec JSON
 * - `manifest.json`                 — package metadata
 *
 * This is intentionally different from `createLibraryPackage` (which emits a
 * library-shell JSON). Here the env spec is the root document — no
 * `environment_specifications` wrapper around it.
 *
 * NOTE: `PACKAGE_TYPES.environmentPackage` and `INNER_JSON_EXTENSIONS` live in
 * `library-package.ts`, which imports this module. To avoid a circular
 * dependency the string literals are used directly — they match the constants
 * in `library-package.ts` exactly.
 */
/**
 * Action-library grouping used by `exportEnvironmentPackage`.
 * Each entry contributes a `actions/{libraryName}/*.WFaction` subdirectory to the ZIP.
 */
export interface EnvironmentPackageActionLibrary {
  libraryName: string
  specs: MasterActionSpecification[]
}

export async function exportEnvironmentPackage(
  env: MasterEnvironmentSpecification,
  includedActions: EnvironmentPackageActionLibrary[] | MasterActionSpecification[],
): Promise<Blob> {
  const zip = new JSZip()

  zip.file(`${env.local_id}.WFenvir`, JSON.stringify(env, null, 2))

  // Normalize: legacy flat array → one synthetic library named after the env.
  // This preserves callers that don't yet know which library each action came
  // from, and the resulting v2 manifest still records library metadata so the
  // importer can do its work the same way for both forms.
  const grouped: EnvironmentPackageActionLibrary[] =
    Array.isArray(includedActions) && includedActions.length > 0 && 'libraryName' in includedActions[0]
      ? (includedActions as EnvironmentPackageActionLibrary[])
      : (includedActions as MasterActionSpecification[]).length > 0
        ? [{ libraryName: env.local_id, specs: includedActions as MasterActionSpecification[] }]
        : []

  // Dedupe action names within each library (last-write-wins on local_id).
  let actionCount = 0
  for (const lib of grouped) {
    const seen = new Map<string, MasterActionSpecification>()
    for (const a of lib.specs) seen.set(a.local_id, a)
    for (const action of seen.values()) {
      zip.file(`actions/${lib.libraryName}/${action.local_id}.WFaction`, JSON.stringify(action, null, 2))
      actionCount++
    }
  }

  zip.file(
    'manifest.json',
    JSON.stringify(
      {
        packageType: 'environment-package',
        formatVersion: 2,
        createdAt: new Date().toISOString(),
        environmentName: env.local_id,
        actionCount,
        actionLibraries: grouped.map((lib) => ({
          name: lib.libraryName,
          actions: [...new Set(lib.specs.map((s) => s.local_id))],
        })),
      },
      null,
      2,
    ),
  )

  return zip.generateAsync({ type: 'blob' })
}
