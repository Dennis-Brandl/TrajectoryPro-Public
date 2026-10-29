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
import { splitDuration } from '@/lib/duration'
import type { Specification, SpecificationState } from '@/types/library'
import type { WorkflowNode, StepNodeData, Select1Operator } from '@/types/nodes'
import type { ConditionalEdgeData } from '@/types/edges'
import type { MasterWorkflowSpecification } from '@/lib/packageFormat/export-types'
import type { FormDocument } from '@mission/form-schema'
import { validateFormDocument } from '@mission/form-schema'
import { generateOID, WORKER_INTERNAL } from '@/lib/snowflake'
import { validateWorkflowSpecification, validateWorkflowLibrary } from './schema-validator'
import {
  transformInputParams,
  transformOutputParams,
  transformPropertySpecs,
  transformResourceCommands,
  transformResourcePropertySpecs,
  transformUIParams,
  ensureYesNoButtonsBlock,
  applyYesNoLabels,
} from './transformers'
import { hydrateFormLayouts } from './form-layout-hydration'
import { convertV1FormLayouts } from '@/lib/form-document/convert-layouts'
import { extractPendingEnvSpecs, populateWorkflowLevelProps } from './pending-extraction'
import { STEP_TYPE_TO_NODE_TYPE } from './type-mapping'
import {
  scriptConfigSchema,
  gateConfigSchema,
  select1ConfigSchema,
  actionVisibilitySchema,
  actionProxyConfigSchema,
  parseOptionalStepConfig,
} from './step-config-schemas'
import { LEGACY_FORMAT_ERROR, isLegacySchemaVersion } from './legacy-detection'
import { readTypeName } from '@/lib/packageFormat/type-name'
import type { WorkflowImportSuccess, ImportError, PendingChildWorkflow } from './import-types'

/**
 * Extracts pending child workflows from a workflow spec, converting each to internal format.
 */
export function extractPendingChildWorkflows(spec: MasterWorkflowSpecification): PendingChildWorkflow[] | undefined {
  if (!spec.children || spec.children.length === 0) {
    return undefined
  }

  const now = Date.now()
  return spec.children.map((child) => importWorkflowSpecToInternal(child, now))
}

/**
 * Imports a single workflow spec into internal format, storing children
 * as _pendingChildWorkflows in the data field for post-creation processing.
 */
export function importWorkflowSpecToInternal(
  spec: MasterWorkflowSpecification,
  now: number,
): Omit<Specification, 'id' | 'libraryId'> {
  const workflowResult = transformWorkflowSpec(spec)

  const data: Record<string, unknown> = {
    nodes: workflowResult.nodes,
    edges: workflowResult.edges,
    workflowInputs: transformInputParams(spec.starting_parameter_specifications) || [],
    workflowOutputs: transformOutputParams(spec.output_parameter_specifications) || [],
    workflowValues: transformPropertySpecs(spec.value_property_specifications) || [],
    workflowResources: transformResourcePropertySpecs(spec.resource_property_specifications) || [],
    workflowTrySpecifications: spec.try_specifications ?? [],
    ...(spec.viewport ? { viewport: spec.viewport } : {}),
    ...(spec.display_style ? { notation: spec.display_style } : {}),
  }

  // Store environment specifications as pending for the sidebar handler to process
  const pendingEnvSpecs = extractPendingEnvSpecs(spec)
  if (pendingEnvSpecs) {
    data._pendingEnvironmentSpecs = pendingEnvSpecs.map((envSpec) => ({
      name: envSpec.name,
      description: envSpec.description,
      data: {
        _libraryName: envSpec.libraryName,
        _version: envSpec.version,
        includedActions: envSpec.includedActions,
        values: envSpec.values,
        actionProperties: envSpec.actionProperties,
        valueTypes: envSpec.valueTypes,
        resources: envSpec.resources,
      },
      createdAt: now,
      updatedAt: now,
    }))
  }

  // Store child workflows as pending for the sidebar handler to process
  if (spec.children && spec.children.length > 0) {
    data._pendingChildWorkflows = spec.children.map((child) => importWorkflowSpecToInternal(child, now))
  }

  // Preserve history if the incoming JSON carries it (forward-compat / round-trip),
  // defaulting to [] when absent. History is editor metadata — the runtime never
  // exports it, but future tool versions might include it for audit purposes.
  const incomingHistory = (spec as unknown as Record<string, unknown>).history
  const history = Array.isArray(incomingHistory) ? incomingHistory : []

  return {
    name: spec.local_id,
    description: spec.description ?? null,
    typeName: readTypeName(spec.type_name),
    version: spec.version || '1.0.0',
    state: ((spec as { state?: string }).state as SpecificationState | undefined) ?? 'Draft',
    data,
    history,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Imports a single Workflow specification from JSON.
 * Validates the JSON and transforms it to React Flow nodes and edges with new UUIDs.
 * Falls back to extracting the first spec from a workflow library if single-spec validation fails.
 */
export function importWorkflow(json: unknown): WorkflowImportSuccess | ImportError {
  // Reject pre-v4.0 files immediately (version-based check only)
  if (isLegacySchemaVersion(json)) {
    return { error: LEGACY_FORMAT_ERROR }
  }

  try {
    const validation = validateWorkflowSpecification(json)

    if (!validation.success) {
      // Fallback: try as a workflow library and extract the first specification
      const libraryValidation = validateWorkflowLibrary(json)
      if (libraryValidation.success && libraryValidation.data.workflow_specifications.length > 0) {
        const spec = libraryValidation.data.workflow_specifications[0]
        const result = transformWorkflowSpec(spec)
        populateWorkflowLevelProps(result, spec)
        result.pendingEnvironmentSpecs = extractPendingEnvSpecs(spec)
        result.pendingChildWorkflows = extractPendingChildWorkflows(spec)
        return result
      }

      console.error('[import] Workflow validation failed (also tried as library):', validation.errors)
      return { error: `Validation failed: ${validation.errors.join(', ')}` }
    }

    const result = transformWorkflowSpec(validation.data)
    populateWorkflowLevelProps(result, validation.data)
    result.pendingEnvironmentSpecs = extractPendingEnvSpecs(validation.data)
    result.pendingChildWorkflows = extractPendingChildWorkflows(validation.data)
    return result
  } catch (e) {
    // Surfaces a step's invalid form_document (thrown by transformWorkflowSpec) in the
    // established { error } shape instead of letting it escape as an uncaught exception.
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Internal helper to transform a workflow specification to nodes and edges.
 */
function transformWorkflowSpec(spec: MasterWorkflowSpecification): WorkflowImportSuccess {
  // Audit item 3: warnings for step-config fields that failed zod validation and
  // were dropped. Attached to the result; the server envelope path also logs them.
  const warnings: string[] = []
  // Transform steps to nodes using their OIDs directly (no remapping)
  const nodes: WorkflowNode[] = spec.steps.map((step, index) => {
    const newId = step.oid
    const nodeType = STEP_TYPE_TO_NODE_TYPE[step.step_type]

    // Map Yes/No configuration
    const yesNoConfig = step.yes_no_config
    const yesNoFields = yesNoConfig
      ? {
          yesNoYesValue: 'true',
          yesNoNoValue: 'false',
          yesNoDefaultSelection: yesNoConfig.default_selection,
        }
      : {}

    // Map Script configuration — zod-parsed at the boundary (audit item 3); a
    // malformed config is dropped with a warning instead of flowing through a cast.
    const scriptConfig = parseOptionalStepConfig(
      scriptConfigSchema,
      (step as unknown as Record<string, unknown>).script_config,
      'script_config',
      step.oid,
      warnings,
    )
    // GATE steps never hydrate from script_config — gate_config is the sole source of truth
    // (spec §4), mirroring the exporter's mutually-exclusive emission of the two fields at
    // each of its three step-map sites. A stray script_config on a hand-edited GATE step
    // (e.g. left over from a step-type swap) is ignored rather than silently winning over
    // an absent/partial gate_config, and is called out with a warning.
    if (nodeType === 'gateStep' && scriptConfig) {
      warnings.push(
        `Step ${step.oid}: script_config present on a GATE step is ignored — gate_config is the sole source of truth`,
      )
    }
    const scriptFields =
      nodeType === 'gateStep'
        ? {}
        : scriptConfig
          ? {
              scriptLanguage: scriptConfig.language,
              scriptSource: scriptConfig.source,
              // Spec 2026-10-13 §6.6: repeat settings hydrate onto the node; the limit as boxes.
              ...(scriptConfig.repeat
                ? {
                    scriptRepeat: true,
                    ...(scriptConfig.repeat.cycle_seconds !== undefined
                      ? { scriptCycleSeconds: scriptConfig.repeat.cycle_seconds }
                      : {}),
                    ...(typeof scriptConfig.repeat.time_limit_seconds === 'number'
                      ? { scriptTimeLimit: splitDuration(scriptConfig.repeat.time_limit_seconds) }
                      : {}),
                    ...(scriptConfig.repeat.on_time_limit === 'complete'
                      ? { scriptOnTimeLimit: 'complete' as const }
                      : {}),
                  }
                : {}),
            }
          : {}

    // Map Gate configuration — zod-parsed at the boundary. The script hydrates onto the
    // SAME node fields the Script step uses; bindings are export-derived and deliberately
    // NOT hydrated onto the node.
    const gateConfig =
      nodeType === 'gateStep'
        ? parseOptionalStepConfig(
            gateConfigSchema,
            (step as unknown as Record<string, unknown>).gate_config,
            'gate_config',
            step.oid,
            warnings,
          )
        : undefined
    const gateFields = gateConfig
      ? {
          ...(gateConfig.cycle_seconds !== undefined ? { gateCycleSeconds: gateConfig.cycle_seconds } : {}),
          ...(gateConfig.language ? { scriptLanguage: gateConfig.language } : {}),
          ...(gateConfig.source ? { scriptSource: gateConfig.source } : {}),
          ...(gateConfig.control_previous_action === true ? { gateControlPreviousAction: true } : {}),
          ...(gateConfig.mode === 'timer'
            ? { gateMode: 'timer' as const }
            : gateConfig.mode === 'condition_or_timer'
              ? { gateMode: 'condition_or_timer' as const }
              : {}),
          ...(typeof gateConfig.delay_seconds === 'number'
            ? { gateDelay: splitDuration(gateConfig.delay_seconds) }
            : {}),
        }
      : {}

    // Map Select 1 configuration — zod-parsed at the boundary (audit item 3).
    const select1Config = parseOptionalStepConfig(
      select1ConfigSchema,
      (step as unknown as Record<string, unknown>).select1_config,
      'select1_config',
      step.oid,
      warnings,
    )
    const select1Fields = select1Config
      ? {
          select1InputName: select1Config.input_name,
          select1InputValueType: select1Config.input_value_type,
          select1Options: select1Config.options?.map((o) => ({
            id: o.id,
            label: o.label,
            operator: o.operator as Select1Operator,
            value: o.value,
            valueType: o.value_type,
            isDefault: o.is_default,
          })),
        }
      : {}

    // Read action_visibility from step data — zod-parsed (audit item 3).
    const actionVisibility = parseOptionalStepConfig(
      actionVisibilitySchema,
      (step as unknown as Record<string, unknown>).action_visibility,
      'action_visibility',
      step.oid,
      warnings,
    )

    // Round-trip the runtime's action_proxy_config object on ACTION PROXY steps.
    // The runtime resolves env-server bindings by scanning every step for
    // `step.action_proxy_config?.environment_oid`; without this preservation,
    // exported workflows lose all proxy targets and the runtime silently no-ops
    // the steps (envsNeedingBinding returns [], coordinator.sync skips on
    // `if (!cfg) continue`). Editor design-time UX uses the separate
    // actionName/actionLibraryName/environmentSpecId fields, but those are NOT
    // emitted into the runtime envelope — the runtime contract is OID-based.
    // zod-parsed (audit item 3): parsed only on actionProxyWait nodes (a config on
    // any other step type stays ignored without noise, as before); an INVALID
    // config on a proxy node now warns instead of silently no-op-ing the step at
    // runtime.
    const parsedProxyConfig =
      nodeType === 'actionProxyWait'
        ? parseOptionalStepConfig(
            actionProxyConfigSchema,
            (step as unknown as Record<string, unknown>).action_proxy_config,
            'action_proxy_config',
            step.oid,
            warnings,
          )
        : undefined
    const actionProxyConfig = parsedProxyConfig
      ? {
          action_oid: parsedProxyConfig.action_oid,
          environment_oid: parsedProxyConfig.environment_oid,
          ...(parsedProxyConfig.timeout_ms !== undefined ? { timeout_ms: parsedProxyConfig.timeout_ms } : {}),
          ...(parsedProxyConfig.action_name !== undefined ? { action_name: parsedProxyConfig.action_name } : {}),
          ...(parsedProxyConfig.environment_name !== undefined
            ? { environment_name: parsedProxyConfig.environment_name }
            : {}),
        }
      : undefined

    const nodeData: StepNodeData = {
      label: step.local_id,
      stepType: nodeType,
      description: step.description,
      inputs: transformInputParams(step.input_parameter_specifications),
      outputs: transformOutputParams(step.output_parameter_specifications),
      values: transformPropertySpecs(step.value_property_specifications),
      resourceCommands: transformResourceCommands(step.resource_command_specifications),
      uiParameters:
        nodeType === 'yesNoStep'
          ? ensureYesNoButtonsBlock(
              transformUIParams(step.ui_parameter_specifications),
              yesNoConfig?.yes_label,
              yesNoConfig?.no_label,
            )
          : transformUIParams(step.ui_parameter_specifications),
      ...yesNoFields,
      ...scriptFields,
      ...gateFields,
      ...select1Fields,
      // Action visibility
      ...(nodeType === 'actionProxyWait' && actionVisibility ? { actionVisibility } : {}),
      // Action-proxy target (round-tripped so re-export produces a runnable workflow)
      ...(actionProxyConfig ? { actionProxyConfig } : {}),
      // TRY/CATCH/RETURN — verbatim inner shape, outer field name translated only
      ...(step.try_specifications ? { trySpecifications: step.try_specifications } : {}),
      ...(step.catch_id ? { catchId: step.catch_id } : {}),
      ...(step.return_config ? { returnConfig: step.return_config } : {}),
    }

    // Form data — v2-native (5.0) or legacy conversion (≤4.0). Spec §3.2.
    const formDocumentRaw = (step as unknown as Record<string, unknown>).form_document
    const formLayoutConfig = (step as unknown as Record<string, unknown>).form_layout_config as
      | Array<{ deviceType: string; canvasWidth: number; canvasHeight: number; elements: unknown[] }>
      | undefined
    if (formDocumentRaw !== undefined) {
      const check = validateFormDocument(formDocumentRaw)
      if (!check.ok) {
        throw new Error(`form_document invalid on step ${step.oid}: ${check.errors.join('; ')}`)
      }
      // The wire shape IS the canonical FormDocument — ids kept verbatim (document-scoped).
      nodeData.formDocument = formDocumentRaw as FormDocument
    } else if (formLayoutConfig) {
      // Legacy ≤4.0 package: hydrate the v1 shape only to feed the converter, then MINT
      // formDocument. formLayouts is no longer persisted on the node (v1 editor is retired).
      const hydrated = hydrateFormLayouts(formLayoutConfig, step.oid)
      if (hydrated) {
        const converted = convertV1FormLayouts(hydrated)
        nodeData.formDocument = converted.document
        if (converted.report.entries.length > 0) {
          console.info(
            `[import] form v1→v2 for step ${step.oid}: ${converted.report.entries.map((e) => `${e.kind}: ${e.detail}`).join(' | ')}`,
          )
        }
        if (converted.yesNoLabels && nodeType === 'yesNoStep') {
          nodeData.uiParameters = applyYesNoLabels(nodeData.uiParameters, converted.yesNoLabels)
        }
      }
    }

    const position = step.position ?? {
      x: 100 + (index % 5) * 200,
      y: 100 + Math.floor(index / 5) * 150,
    }

    return {
      id: newId,
      type: nodeType,
      position,
      data: nodeData,
    } as WorkflowNode
  })

  // Reconstruct workflowProxy linkage from children placement.
  // The runtime WFmaster format omits step.sub_workflow_mode and step.embedded_workflow
  // on inlined proxies — the runtime engine matches step.local_id to children[].local_id.
  // The editor canvas double-click handler reads node.data.embeddedWorkflowSpecId, so
  // we mirror the same matching here to restore the linkage after import.
  if (Array.isArray(spec.children)) {
    for (const child of spec.children) {
      if (!child || typeof child.local_id !== 'string' || typeof child.oid !== 'string') continue
      const step = spec.steps.find((s) => s.local_id === child.local_id && s.step_type === 'WORKFLOW PROXY')
      if (!step) {
        console.warn(
          `[import] No WORKFLOW PROXY step found for child local_id="${child.local_id}" (oid=${child.oid}) — skipping linkage`,
        )
        continue
      }
      const node = nodes.find((n) => n.id === step.oid)
      if (!node) continue
      const nodeData = node.data as Record<string, unknown>
      nodeData.subWorkflowMode = 'embedded'
      nodeData.embeddedWorkflowSpecId = child.oid
    }
  }

  // Transform connections to edges using OIDs directly (no remapping)
  const edges: Edge<ConditionalEdgeData>[] = spec.connections.map((conn) => {
    const edgeData: ConditionalEdgeData | undefined =
      conn.condition || conn.waypoints || conn.connection_id
        ? {
            ...(conn.condition ? { condition: conn.condition } : {}),
            ...(conn.waypoints ? { waypoints: conn.waypoints } : {}),
            ...(conn.connection_id ? { connectionId: conn.connection_id } : {}),
          }
        : undefined

    return {
      id: generateOID(WORKER_INTERNAL),
      source: conn.from_step_id,
      target: conn.to_step_id,
      sourceHandle: conn.source_handle_id || undefined,
      type: 'conditional',
      data: edgeData,
    }
  })

  if (warnings.length > 0) {
    // Server-side envelope imports read the result via importWorkflowSpecToInternal,
    // whose return shape (a Specification) has no warnings channel — log there so
    // dropped configs are never fully silent. Client flows read result.warnings.
    console.warn(`[import] workflow "${spec.local_id}": ${warnings.join('; ')}`)
    return { nodes, edges, warnings }
  }
  return { nodes, edges }
}
