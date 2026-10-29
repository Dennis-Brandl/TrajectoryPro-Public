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

import type { Edge } from '@xyflow/react'
import type { Library, Specification, ChildSpecification, SpecificationState } from '@/types/library'
import type { WorkflowNode, StepNodeData } from '@/types/nodes'
import type { ConditionalEdgeData } from '@/types/edges'
import {
  type LibraryWithChildren,
  type MasterWorkflowSpecification,
  type MasterWorkflowLibrary,
  type MasterWorkflowStep,
  type WorkflowConnection,
  NODE_TYPE_TO_STEP_TYPE,
  CURRENT_SCHEMA_VERSION,
  TRY_CAPABLE_NODE_TYPES,
} from './export-types'
import { specToManagedElement, nodeToManagedElement, libraryToManagedElement } from './entity-converters'
import {
  extractInputParams,
  extractOutputParams,
  extractStepOutputParams,
  extractPropertySpecs,
  extractWorkflowResourceSpecs,
} from './parameter-extractors'
import {
  extractResourceCommands,
  extractUIParameters,
  extractYesNoConfig,
  extractScriptConfig,
  extractGateConfig,
  extractFormDocument,
  extractFormElementImages,
  extractSelect1Config,
  extractTrySpecifications,
  extractReturnConfig,
  extractCatchId,
} from './step-extractors'
import { applyActionPropertyBindings } from './action-property-bindings'
import { exportEnvironmentSpec, type EnvExportOptions } from './library-exporters'
import { resolveActionSpecForNode } from '@/lib/action-proxy/resolve-action-spec'
import { proxyTimeoutMs } from '@/lib/action-proxy/default-timeout'
import type { ResourceSpec } from '@/types/nodes'
import type { ResourceCommandSpecification, ChildWorkflowExport } from './export-types'

// =============================================================================
// Child Tree Assembly (inlined from Phase 3 B11 cleanup)
// =============================================================================

/**
 * Recursively builds a nested ChildWorkflowExport tree from a flat ChildSpecification array.
 *
 * @param allChildren - All ChildSpecification records for the root spec (any depth).
 * @param parentChildSpecId - The parentChildSpecId to filter by (null = direct children of root).
 * @param visited - Set of child spec IDs already visited — detects circular references.
 * @returns Array of ChildWorkflowExport objects for this level of the tree.
 */
function buildNestedChildExport(
  allChildren: ChildSpecification[],
  parentChildSpecId: string | null,
  visited: Set<string>,
  allSpecs: Specification[] | undefined,
  inherited: { state: string; version: string; libraryName?: string; libraryOid?: string },
  rootEnvContext: {
    workflowData: Record<string, unknown>
    specById: Map<string, Specification> | undefined
    allLibraries: Library[] | undefined
    specsByLibraryId: Map<string, Specification[]> | undefined
  },
): ChildWorkflowExport[] {
  const directChildren = allChildren.filter((c) => c.parentChildSpecId === parentChildSpecId)
  if (directChildren.length === 0) return []

  return directChildren.map((child) => {
    if (visited.has(child.id)) {
      throw new Error(`Circular reference detected at child spec ${child.id} (${child.name})`)
    }
    visited.add(child.id)

    const data = child.data as Record<string, unknown>
    const nodes = (data.nodes ?? []) as WorkflowNode[]
    const edges = (data.edges ?? []) as Edge<ConditionalEdgeData>[]

    const steps: MasterWorkflowStep[] = nodes.map((node) => {
      const nodeData = node.data as StepNodeData
      const nodeType = nodeData.stepType
      return {
        ...nodeToManagedElement(node),
        step_type: NODE_TYPE_TO_STEP_TYPE[nodeType],
        resource_command_specifications: extractResourceCommands(nodeData),
        value_property_specifications: extractPropertySpecs(nodeData),
        input_parameter_specifications: extractInputParams(nodeData),
        output_parameter_specifications: extractStepOutputParams(nodeType, nodeData),
        ui_parameter_specifications: extractUIParameters(nodeData),
        yes_no_config: extractYesNoConfig(nodeData),
        script_config: nodeType === 'gateStep' ? undefined : extractScriptConfig(nodeData),
        gate_config:
          nodeType === 'gateStep' ? extractGateConfig(nodeData as unknown as Record<string, unknown>) : undefined,
        select1_config: extractSelect1Config(nodeData),
        form_document:
          nodeType === 'userInteractionStep' || nodeType === 'yesNoStep'
            ? extractFormDocument(nodeData as unknown as Record<string, unknown>)
            : undefined,
        form_element_images:
          nodeType === 'userInteractionStep' || nodeType === 'yesNoStep'
            ? extractFormElementImages(nodeData as unknown as Record<string, unknown>)
            : undefined,
        action_visibility: nodeType === 'actionProxyWait' ? nodeData.actionVisibility || 'opaque' : undefined,
        // Child workflow steps have no environment_specifications of their own —
        // the engine resolves child env refs against the ROOT workflow's attached
        // environments (findEnvSpec root fallback), so derive identity against
        // rootEnvContext rather than this child's own (nonexistent) env roster.
        action_proxy_config:
          nodeType === 'actionProxyWait'
            ? buildActionProxyConfig(
                rootEnvContext.workflowData,
                nodeData,
                rootEnvContext.specById ?? new Map(),
                rootEnvContext.allLibraries,
                rootEnvContext.specsByLibraryId,
              )
            : undefined,
        try_specifications: TRY_CAPABLE_NODE_TYPES.has(nodeType)
          ? extractTrySpecifications(nodeData as unknown as Record<string, unknown>)
          : undefined,
        catch_id: nodeType === 'catch' ? extractCatchId(nodeData as unknown as Record<string, unknown>) : undefined,
        return_config:
          nodeType === 'return' ? extractReturnConfig(nodeData as unknown as Record<string, unknown>) : undefined,
        position: node.position,
      }
    })

    // Per spec, resource_source_oid for resource_source_type='workflow' must be
    // the runtime oid of the workflow that DECLARES the resource. For a step
    // inside this child, when its resource command names a resource declared
    // on this same child's workflowResources, that oid is `child.id`. The
    // editor's stored resourceSourceOid can go stale (renames, deep-clone of
    // a referenced library step, schema migration), so we always resolve here
    // from the live tree rather than trusting whatever's persisted.
    const childAsSpec: Specification = {
      id: child.id,
      libraryId: '',
      name: child.name,
      description: child.description,
      typeName: child.typeName ?? null,
      data: child.data,
      version: inherited.version,
      state: inherited.state as SpecificationState,
      history: [],
      createdAt: child.createdAt,
      updatedAt: child.updatedAt,
    }
    const childSourceMap = buildResourceSourceMap(childAsSpec, allSpecs ?? [])
    resolveResourceSources(steps, childSourceMap)

    const connections: WorkflowConnection[] = edges.map((edge) => ({
      from_step_id: edge.source,
      to_step_id: edge.target,
      condition: edge.data?.condition,
      connection_id: edge.data?.connectionId,
      source_handle_id: edge.sourceHandle || undefined,
      waypoints: edge.data?.waypoints,
    }))

    const workflowLevelData = {
      inputs: data.workflowInputs,
      outputs: data.workflowOutputs,
      values: data.workflowValues,
      workflowResources: data.workflowResources,
      trySpecifications: data.workflowTrySpecifications,
    } as Record<string, unknown>

    const specNotation = data.notation as string | undefined
    const viewport = data.viewport as { x: number; y: number; zoom: number } | undefined

    const workflowSpec: MasterWorkflowSpecification = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      display_style: (specNotation as MasterWorkflowSpecification['display_style']) || undefined,
      local_id: child.name,
      oid: child.id,
      description: child.description ?? undefined,
      ...(childAsSpec.typeName ? { type_name: childAsSpec.typeName } : {}),
      version: inherited.version,
      state: inherited.state,
      ...(inherited.libraryName ? { library_name: inherited.libraryName } : {}),
      ...(inherited.libraryOid ? { library_oid: inherited.libraryOid } : {}),
      last_modified_date: new Date(child.updatedAt).toISOString(),
      steps,
      connections,
      resource_property_specifications: extractWorkflowResourceSpecs(workflowLevelData),
      starting_parameter_specifications: extractInputParams(workflowLevelData),
      try_specifications: extractTrySpecifications(workflowLevelData),
      output_parameter_specifications: extractOutputParams(workflowLevelData),
      value_property_specifications: extractPropertySpecs(workflowLevelData),
      viewport,
    }

    const grandchildren = buildNestedChildExport(allChildren, child.id, visited, allSpecs, inherited, rootEnvContext)

    const result: ChildWorkflowExport = {
      ...workflowSpec,
      parentChildSpecId: child.parentChildSpecId,
      version: inherited.version,
      state: inherited.state,
    }

    if (grandchildren.length > 0) {
      result.children = grandchildren
    }

    return result
  })
}

// =============================================================================
// Resource Source Resolution
// =============================================================================

interface ResourceSource {
  type: 'workflow' | 'environment'
  oid: string
  /** The declaring resource's UI type — drives the Count Limited → pool-command
   *  rewrite in resolveResourceSources (JSON_SCHEMA §1.7.5). */
  resourceType?: string
}

/**
 * Builds a map from resource name to its source (workflow or environment)
 * by walking the spec hierarchy: current workflow, its environments,
 * parent workflows, and parent environments.
 */
function buildResourceSourceMap(spec: Specification, allSpecs: Specification[]): Map<string, ResourceSource> {
  const map = new Map<string, ResourceSource>()
  const specData = spec.data as Record<string, unknown> | null

  // Current workflow resources
  const workflowResources = (specData?.workflowResources ?? []) as ResourceSpec[]
  for (const r of workflowResources) {
    if (!map.has(r.name)) {
      map.set(r.name, { type: 'workflow', oid: spec.id, resourceType: r.resourceType })
    }
  }

  // Current workflow's environment resources
  const envSpecIds = (specData?.environmentSpecIds ?? []) as string[]
  for (const envId of envSpecIds) {
    const envSpec = allSpecs.find((s) => s.id === envId)
    if (!envSpec) continue
    const envData = envSpec.data as Record<string, unknown> | null
    const envResources = (envData?.resources ?? []) as ResourceSpec[]
    for (const r of envResources) {
      if (!map.has(r.name)) {
        map.set(r.name, { type: 'environment', oid: envSpec.id, resourceType: r.resourceType })
      }
    }
  }

  // Walk up parent chain
  let parentId = specData?.parentSpecificationId as string | undefined
  while (parentId) {
    const parentSpec = allSpecs.find((s) => s.id === parentId)
    if (!parentSpec) break
    const parentData = parentSpec.data as Record<string, unknown> | null

    // Parent workflow resources
    const parentResources = (parentData?.workflowResources ?? []) as ResourceSpec[]
    for (const r of parentResources) {
      if (!map.has(r.name)) {
        map.set(r.name, { type: 'workflow', oid: parentSpec.id, resourceType: r.resourceType })
      }
    }

    // Parent environment resources
    const parentEnvIds = (parentData?.environmentSpecIds ?? []) as string[]
    for (const envId of parentEnvIds) {
      const envSpec = allSpecs.find((s) => s.id === envId)
      if (!envSpec) continue
      const envData = envSpec.data as Record<string, unknown> | null
      const envResources = (envData?.resources ?? []) as ResourceSpec[]
      for (const r of envResources) {
        if (!map.has(r.name)) {
          map.set(r.name, { type: 'environment', oid: envSpec.id, resourceType: r.resourceType })
        }
      }
    }

    parentId = parentData?.parentSpecificationId as string | undefined
  }

  return map
}

/**
 * Enriches resource_command_specifications on all steps with resolved
 * resource_source_type and resource_source_oid from the workflow hierarchy.
 */
function resolveResourceSources(steps: MasterWorkflowStep[], sourceMap: Map<string, ResourceSource>): void {
  for (const step of steps) {
    if (!step.resource_command_specifications) continue
    step.resource_command_specifications = step.resource_command_specifications.map(
      (cmd: ResourceCommandSpecification) => {
        const source = sourceMap.get(cmd.resource_name)
        // Count Limited resources take the schema's pool commands (JSON_SCHEMA §1.7.5):
        // the editor authors plain Acquire/Release with a count (it has no pool-command
        // UI), so the export rewrites them here — the one pass every export path runs.
        // Without this, every runtime validator rejects the workflow at start with
        // INVALID_RESOURCE_COMMAND. The validators also demand amount > 0, so an
        // absent count defaults to 1 (the editor's own default).
        const countable = source?.resourceType === 'Count Limited'
        const command_type =
          countable && cmd.command_type === 'Acquire'
            ? ('Acquire Pool Amount' as const)
            : countable && cmd.command_type === 'Release'
              ? ('Release Pool Amount' as const)
              : cmd.command_type
        const amount =
          command_type === 'Acquire Pool Amount' || command_type === 'Release Pool Amount'
            ? cmd.amount && cmd.amount > 0
              ? cmd.amount
              : 1
            : cmd.amount
        return {
          ...cmd,
          command_type,
          amount,
          resource_source_type: source?.type ?? cmd.resource_source_type ?? 'workflow',
          resource_source_oid: source?.oid ?? cmd.resource_source_oid ?? '',
        }
      },
    )
  }
}

// =============================================================================
// Private Helpers (library export backward compat)
// =============================================================================

/**
 * Finds child Specification records by parentSpecificationId stored in spec.data.
 * Used only by the library export path (exportWorkflowLibrary) which does not have
 * a ChildSpecification tree. Not exported — internal use only.
 */
function _findChildSpecsByParentId(parentSpecId: string, allSpecs: Specification[]): Specification[] {
  return allSpecs.filter((s) => {
    const data = s.data as { parentSpecificationId?: string } | null
    return data?.parentSpecificationId === parentSpecId
  })
}

/**
 * Groups specs by their `libraryId` for use as the resolver index when inlining
 * action bodies inside environment exports.
 */
function groupSpecsByLibrary(allSpecs: Specification[]): Map<string, Specification[]> {
  const map = new Map<string, Specification[]>()
  for (const s of allSpecs) {
    const list = map.get(s.libraryId)
    if (list) list.push(s)
    else map.set(s.libraryId, [s])
  }
  return map
}

// =============================================================================
// action_proxy_config fallback derivation
// =============================================================================

/**
 * Name-first resolution of an ACTION PROXY step's runtime identity (spec
 * 2026-08-21 action-proxy name binding). The emitted roster is synthesized by
 * name on every export (library-exporters.ts resolveActionBody), so the step
 * config MUST come from the same lookup or the two silently drift apart —
 * which is exactly the stale-oid bug this replaces: the stored
 * actionProxyConfig was written once at import and previously always won.
 *
 * Env candidate order: the node's own environmentSpecId (when attached),
 * then the workflow's remaining attached envs. First env whose roster
 * name-matches the node's action wins. Returns undefined when nothing
 * resolves — the caller falls back to the stored config (today's behavior).
 *
 * Delegates to resolveActionSpecForNode (spec 2026-09-04 §6.1).
 */
function resolveProxyIdentityByName(
  workflowData: Record<string, unknown>,
  nodeData: StepNodeData,
  specById: Map<string, Specification>,
  allLibraries: Library[] | undefined,
  allSpecsByLibrary: Map<string, Specification[]> | undefined,
): { action_oid: string; environment_oid: string; action_name: string; environment_name: string } | undefined {
  if (!allLibraries || !allSpecsByLibrary) return undefined
  const hit = resolveActionSpecForNode(workflowData, nodeData, specById, allLibraries, allSpecsByLibrary)
  if (!hit) return undefined
  return {
    action_oid: hit.actionSpec.id,
    environment_oid: hit.envSpec.id,
    action_name: hit.actionSpec.name,
    environment_name: hit.envSpec.name,
  }
}

/** The single emission rule for all three export sites: derived identity wins
 *  (consistent with the roster by construction), stored config is the fallback,
 *  and stored timeout_ms always survives (it is authored data, not identity); with none
 *  stored there is no default: the key is omitted (no deadline). */
function buildActionProxyConfig(
  workflowData: Record<string, unknown>,
  nodeData: StepNodeData,
  specById: Map<string, Specification>,
  allLibraries: Library[] | undefined,
  allSpecsByLibrary: Map<string, Specification[]> | undefined,
): NonNullable<StepNodeData['actionProxyConfig']> | undefined {
  const derived = resolveProxyIdentityByName(workflowData, nodeData, specById, allLibraries, allSpecsByLibrary)
  const stored = nodeData.actionProxyConfig
  if (derived) {
    // No key at all when there is no deadline: the engine reads a missing timeout_ms as none.
    const timeout = proxyTimeoutMs(stored?.timeout_ms)
    return timeout === undefined ? derived : { ...derived, timeout_ms: timeout }
  }
  return stored
}

// =============================================================================
// Workflow Export Functions
// =============================================================================

/**
 * Export a single workflow specification with recursive children.
 *
 * When `childTree` is provided (new path — single workflow export via specificationStore),
 * uses buildNestedChildExport to produce the `children` field from ChildSpecification records.
 *
 * When `childTree` is NOT provided (backward compat — library export path),
 * falls back to scanning allSpecs by parentSpecificationId and recursively calls
 * exportWorkflowSpec to assemble `children`.
 */
export function exportWorkflowSpec(
  spec: Specification,
  allSpecs: Specification[],
  allLibraries?: Library[],
  notation?: string,
  childTree?: ChildSpecification[],
  specById?: Map<string, Specification>,
  libById?: Map<string, Library>,
  specsByLibraryId?: Map<string, Specification[]>,
  opts?: EnvExportOptions,
): MasterWorkflowSpecification {
  // Build O(1) lookup indexes on first call, reuse in recursive calls
  if (!specById) {
    specById = new Map(allSpecs.map((s) => [s.id, s]))
  }
  if (!libById && allLibraries) {
    libById = new Map(allLibraries.map((l) => [l.id, l]))
  }
  if (!specsByLibraryId) {
    specsByLibraryId = groupSpecsByLibrary(allSpecs)
  }

  const { versionHistory: _versionHistory, ...data } = spec.data as Record<string, unknown> & {
    versionHistory?: unknown
  }
  const nodes = (data.nodes ?? []) as WorkflowNode[]
  const edges = (data.edges ?? []) as Edge<ConditionalEdgeData>[]

  // Transform nodes to steps (with position)
  const steps: MasterWorkflowStep[] = nodes.map((node) => {
    const nodeData = node.data as StepNodeData
    const nodeType = nodeData.stepType
    // For ACTION PROXY steps, derive the runtime identity by name from the
    // same env roster the export embeds (buildActionProxyConfig /
    // resolveProxyIdentityByName above) — this keeps the step's oids
    // consistent with the emitted roster by construction, instead of
    // trusting a stored oid that can drift stale. Falls back to the node's
    // stored actionProxyConfig verbatim when nothing resolves by name.
    const actionProxyConfig =
      nodeType === 'actionProxyWait'
        ? buildActionProxyConfig(data, nodeData, specById!, allLibraries, specsByLibraryId)
        : undefined
    return {
      ...nodeToManagedElement(node),
      step_type: NODE_TYPE_TO_STEP_TYPE[nodeType],
      resource_command_specifications: extractResourceCommands(nodeData),
      value_property_specifications: extractPropertySpecs(nodeData),
      input_parameter_specifications: extractInputParams(nodeData),
      output_parameter_specifications: extractStepOutputParams(nodeType, nodeData),
      ui_parameter_specifications: extractUIParameters(nodeData),
      yes_no_config: extractYesNoConfig(nodeData),
      script_config: nodeType === 'gateStep' ? undefined : extractScriptConfig(nodeData),
      gate_config:
        nodeType === 'gateStep' ? extractGateConfig(nodeData as unknown as Record<string, unknown>) : undefined,
      select1_config: extractSelect1Config(nodeData),
      form_document:
        nodeType === 'userInteractionStep' || nodeType === 'yesNoStep'
          ? extractFormDocument(nodeData as unknown as Record<string, unknown>)
          : undefined,
      form_element_images:
        nodeType === 'userInteractionStep' || nodeType === 'yesNoStep'
          ? extractFormElementImages(nodeData as unknown as Record<string, unknown>)
          : undefined,
      action_visibility: nodeType === 'actionProxyWait' ? nodeData.actionVisibility || 'opaque' : undefined,
      action_proxy_config: actionProxyConfig,
      try_specifications: TRY_CAPABLE_NODE_TYPES.has(nodeType)
        ? extractTrySpecifications(nodeData as unknown as Record<string, unknown>)
        : undefined,
      catch_id: nodeType === 'catch' ? extractCatchId(nodeData as unknown as Record<string, unknown>) : undefined,
      return_config:
        nodeType === 'return' ? extractReturnConfig(nodeData as unknown as Record<string, unknown>) : undefined,
      position: node.position,
    }
  })

  // Transform edges to connections (with waypoints)
  const connections: WorkflowConnection[] = edges.map((edge) => ({
    from_step_id: edge.source,
    to_step_id: edge.target,
    condition: edge.data?.condition,
    connection_id: edge.data?.connectionId,
    source_handle_id: edge.sourceHandle || undefined,
    waypoints: edge.data?.waypoints,
  }))

  // Extract viewport if present
  const viewport = data.viewport as { x: number; y: number; zoom: number } | undefined

  // Map workflow-level fields to what extractors expect
  const workflowLevelData = {
    inputs: data.workflowInputs,
    outputs: data.workflowOutputs,
    values: data.workflowValues,
    workflowResources: data.workflowResources,
    trySpecifications: data.workflowTrySpecifications,
  } as Record<string, unknown>

  // Resolve display style: prefer per-spec notation, fall back to caller's notation
  const specNotation = data.notation as string | undefined
  const displayStyle = (specNotation || notation) as MasterWorkflowSpecification['display_style']

  const ownLib = libById?.get(spec.libraryId)

  const result: MasterWorkflowSpecification = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    display_style: displayStyle || undefined,
    ...specToManagedElement(spec),
    ...(spec.typeName ? { type_name: spec.typeName } : {}),
    state: spec.state,
    ...(ownLib ? { library_name: ownLib.name, library_oid: ownLib.id } : {}),
    steps,
    connections,
    resource_property_specifications: extractWorkflowResourceSpecs(workflowLevelData),
    starting_parameter_specifications: extractInputParams(workflowLevelData),
    try_specifications: extractTrySpecifications(workflowLevelData),
    output_parameter_specifications: extractOutputParams(workflowLevelData),
    value_property_specifications: extractPropertySpecs(workflowLevelData),
    viewport,
  }

  // Embed referenced environment specifications (O(1) lookups via index)
  const envSpecIds = data.environmentSpecIds as string[] | undefined
  if (envSpecIds && envSpecIds.length > 0) {
    const envSpecs = envSpecIds.map((id) => specById!.get(id)).filter((s): s is Specification => s !== undefined)
    if (envSpecs.length > 0) {
      result.environment_specifications = envSpecs.map((es) => {
        const lib = libById?.get(es.libraryId)
        return exportEnvironmentSpec(es, lib?.name, allLibraries, specsByLibraryId, lib?.id, opts)
      })
    }
  }

  // Resolve resource source info on all step resource commands
  const sourceMap = buildResourceSourceMap(spec, allSpecs)
  resolveResourceSources(steps, sourceMap)

  // Assemble children:
  // - New path (childTree provided): use buildNestedChildExport from ChildSpecification data
  // - Legacy path (no childTree): scan allSpecs by parentSpecificationId for library export compat
  if (childTree !== undefined) {
    // New path — assemble from ChildSpecification tree
    const nestedChildren = buildNestedChildExport(
      childTree,
      null,
      new Set(),
      allSpecs,
      {
        state: spec.state,
        version: spec.version,
        libraryName: ownLib?.name,
        libraryOid: ownLib?.id,
      },
      { workflowData: data, specById, allLibraries, specsByLibraryId },
    )
    if (nestedChildren.length > 0) {
      result.children = nestedChildren
    }
  } else {
    // Legacy library export path — fall back to parentSpecificationId scan
    const childSpecs = _findChildSpecsByParentId(spec.id, allSpecs)
    if (childSpecs.length > 0) {
      // The parent's applyActionPropertyBindings walks result.children once (below) — a
      // child that also reported into a shared sink would duplicate every warning.
      const childOpts = opts ? { ...opts, warnings: undefined } : undefined
      result.children = childSpecs.map((child) =>
        exportWorkflowSpec(
          child,
          allSpecs,
          allLibraries,
          notation,
          undefined,
          specById,
          libById,
          specsByLibraryId,
          childOpts,
        ),
      ) as typeof result.children
    }
  }

  const bindingWarnings = applyActionPropertyBindings(result)
  if (bindingWarnings.length > 0) {
    console.warn(`[export] ${result.local_id}: ${bindingWarnings.join('; ')}`)
    opts?.warnings?.push(...bindingWarnings)
  }

  return result
}

/**
 * Export a Workflow Library to Trajectory schema format.
 */
export function exportWorkflowLibrary(
  library: Library,
  specifications: Specification[],
  children?: LibraryWithChildren[],
  allSpecsByLibrary?: Map<string, Specification[]>,
  allLibraries?: Library[],
  opts?: EnvExportOptions,
): MasterWorkflowLibrary {
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

  const result: MasterWorkflowLibrary = {
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
      exportWorkflowLibrary(child.library, child.specifications, child.children, allSpecsByLibrary, allLibraries, opts),
    )
  }

  return result
}

/**
 * Export a single Workflow specification with its nodes and edges.
 *
 * When `childTree` is provided (new path — runtime package export via specificationStore),
 * uses buildNestedChildExport to produce the `children` field.
 * When `childTree` is NOT provided, skips child assembly entirely.
 */
export function exportWorkflow(
  spec: Specification,
  nodes: WorkflowNode[],
  edges: Edge<ConditionalEdgeData>[],
  viewport?: { x: number; y: number; zoom: number },
  allSpecs?: Specification[],
  allLibraries?: Library[],
  notation?: string,
  childTree?: ChildSpecification[],
  opts?: EnvExportOptions,
): MasterWorkflowSpecification {
  // Build O(1) lookup indexes for env spec and library resolution
  const sById = allSpecs ? new Map(allSpecs.map((s) => [s.id, s])) : undefined
  const lById = allLibraries ? new Map(allLibraries.map((l) => [l.id, l])) : undefined
  const sByLibId = allSpecs ? groupSpecsByLibrary(allSpecs) : undefined
  const ownLib = lById?.get(spec.libraryId)

  // Transform nodes to steps (with position)
  const steps: MasterWorkflowStep[] = nodes.map((node) => {
    const data = node.data as StepNodeData
    const nodeType = data.stepType
    return {
      ...nodeToManagedElement(node),
      step_type: NODE_TYPE_TO_STEP_TYPE[nodeType],
      resource_command_specifications: extractResourceCommands(data),
      value_property_specifications: extractPropertySpecs(data),
      input_parameter_specifications: extractInputParams(data),
      output_parameter_specifications: extractStepOutputParams(nodeType, data),
      ui_parameter_specifications: extractUIParameters(data),
      yes_no_config: extractYesNoConfig(data),
      script_config: nodeType === 'gateStep' ? undefined : extractScriptConfig(data),
      gate_config: nodeType === 'gateStep' ? extractGateConfig(data as unknown as Record<string, unknown>) : undefined,
      select1_config: extractSelect1Config(data),
      form_document:
        nodeType === 'userInteractionStep' || nodeType === 'yesNoStep'
          ? extractFormDocument(data as unknown as Record<string, unknown>)
          : undefined,
      form_element_images:
        nodeType === 'userInteractionStep' || nodeType === 'yesNoStep'
          ? extractFormElementImages(data as unknown as Record<string, unknown>)
          : undefined,
      action_visibility: nodeType === 'actionProxyWait' ? data.actionVisibility || 'opaque' : undefined,
      action_proxy_config:
        nodeType === 'actionProxyWait'
          ? buildActionProxyConfig(
              spec.data as Record<string, unknown>,
              data,
              sById ?? new Map(),
              allLibraries,
              sByLibId,
            )
          : undefined,
      try_specifications: TRY_CAPABLE_NODE_TYPES.has(nodeType)
        ? extractTrySpecifications(data as unknown as Record<string, unknown>)
        : undefined,
      catch_id: nodeType === 'catch' ? extractCatchId(data as unknown as Record<string, unknown>) : undefined,
      return_config:
        nodeType === 'return' ? extractReturnConfig(data as unknown as Record<string, unknown>) : undefined,
      position: node.position,
    }
  })

  // Transform edges to connections (with waypoints)
  const connections: WorkflowConnection[] = edges.map((edge) => ({
    from_step_id: edge.source,
    to_step_id: edge.target,
    condition: edge.data?.condition,
    connection_id: edge.data?.connectionId,
    source_handle_id: edge.sourceHandle || undefined,
    waypoints: edge.data?.waypoints,
  }))

  // Map workflow-level fields to what extractors expect
  const workflowLevelData = {
    inputs: spec.data.workflowInputs,
    outputs: spec.data.workflowOutputs,
    values: spec.data.workflowValues,
    workflowResources: spec.data.workflowResources,
    trySpecifications: spec.data.workflowTrySpecifications,
  } as Record<string, unknown>

  // Resolve display style: prefer per-spec notation, fall back to caller's notation
  const specNotation = spec.data.notation as string | undefined
  const displayStyle = (specNotation || notation) as MasterWorkflowSpecification['display_style']

  const result: MasterWorkflowSpecification = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    display_style: displayStyle || undefined,
    ...specToManagedElement(spec),
    ...(spec.typeName ? { type_name: spec.typeName } : {}),
    state: spec.state,
    ...(ownLib ? { library_name: ownLib.name, library_oid: ownLib.id } : {}),
    steps,
    connections,
    resource_property_specifications: extractWorkflowResourceSpecs(workflowLevelData),
    starting_parameter_specifications: extractInputParams(workflowLevelData),
    try_specifications: extractTrySpecifications(workflowLevelData),
    output_parameter_specifications: extractOutputParams(workflowLevelData),
    value_property_specifications: extractPropertySpecs(workflowLevelData),
    viewport,
  }

  // Embed referenced environment specifications (O(1) lookups via index)
  if (allSpecs && sById) {
    const envSpecIds = spec.data.environmentSpecIds as string[] | undefined
    if (envSpecIds && envSpecIds.length > 0) {
      const envSpecs = envSpecIds.map((id) => sById.get(id)).filter((s): s is Specification => s !== undefined)
      if (envSpecs.length > 0) {
        result.environment_specifications = envSpecs.map((es) => {
          const lib = lById?.get(es.libraryId)
          return exportEnvironmentSpec(es, lib?.name, allLibraries, sByLibId, lib?.id, opts)
        })
      }
    }
  }

  // Resolve resource source info on all step resource commands
  const sourceMap = buildResourceSourceMap(spec, allSpecs ?? [])
  resolveResourceSources(steps, sourceMap)

  // Assemble children from childTree if provided (new path — runtime package export)
  if (childTree !== undefined) {
    const nestedChildren = buildNestedChildExport(
      childTree,
      null,
      new Set(),
      allSpecs,
      {
        state: spec.state,
        version: spec.version,
        libraryName: ownLib?.name,
        libraryOid: ownLib?.id,
      },
      { workflowData: spec.data as Record<string, unknown>, specById: sById, allLibraries, specsByLibraryId: sByLibId },
    )
    if (nestedChildren.length > 0) {
      result.children = nestedChildren
    }
  }

  const bindingWarnings = applyActionPropertyBindings(result)
  if (bindingWarnings.length > 0) {
    console.warn(`[export] ${result.local_id}: ${bindingWarnings.join('; ')}`)
    opts?.warnings?.push(...bindingWarnings)
  }

  return result
}
