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

import type { NodeType, SchemaVersion } from '@/types/nodes'
import type { Library, Specification } from '@/types/library'
import type { FormDocument } from '@mission/form-schema'

/** The envelope version Mission Designer emits. Import accepts 4.0 ≤ v ≤ this. */
export const CURRENT_SCHEMA_VERSION: SchemaVersion = '5.0'

// =============================================================================
// Library Tree Helper Type
// =============================================================================

/**
 * Represents a library with its specifications and recursive children.
 * Used by the sidebar to gather the full library tree for export.
 */
export interface LibraryWithChildren {
  library: Library
  specifications: Specification[]
  children: LibraryWithChildren[]
}

// =============================================================================
// Trajectory Schema Types (JSON Export Format)
// =============================================================================

/**
 * Base managed element structure for all Trajectory entities.
 */
export interface ManagedElement {
  local_id: string
  oid: string
  description?: string
  version: string
  last_modified_date: string
}

/**
 * Parameter specification in Trajectory schema format.
 */
export interface ParameterSpecification {
  id: string
  oid?: string
  description?: string
  default_value: string
  /** Whether value is a literal string or a value property reference */
  value_type?: 'literal' | 'property'
  json_schema?: string
  /** Structured entries defining the parameter data shape */
  entries?: PropertyEntrySpecification[]
}

/**
 * Output parameter specification in Trajectory schema format.
 */
export interface OutputParameterSpecification {
  id: string
  oid?: string
  description?: string
  /** Value property name where this output is stored */
  target?: string
  /** Structured entries defining the parameter data shape */
  entries?: PropertyEntrySpecification[]
}

/**
 * Entry within a property specification in Trajectory schema format.
 */
export interface PropertyEntrySpecification {
  name: string
  value: string
}

/**
 * Property specification in Trajectory schema format.
 */
export interface PropertySpecification {
  name: string
  oid?: string
  entries: PropertyEntrySpecification[]
}

/**
 * Entry template within a Value Type specification.
 */
export interface ValueTypeEntrySpecification {
  name: string
  /** Default value copied into properties created from this type */
  value?: string
}

/**
 * Value Type specification — Designer-only authoring templates. Emitted ONLY
 * into Designer library packages (.WFenvirLibX / .WFlibX / .WFstepLibX), never
 * into runtime packages (spec 2026-08-24-value-types-design.md §4.2).
 */
export interface ValueTypeSpecification {
  name: string
  oid?: string
  description?: string
  entries: ValueTypeEntrySpecification[]
}

/**
 * Resource command specification in Trajectory schema format.
 */
export interface ResourceCommandSpecification {
  oid?: string
  command_type:
    | 'Acquire'
    | 'Release'
    | 'Acquire Pool Amount'
    | 'Release Pool Amount'
    | 'Send'
    | 'Receive'
    | 'Synchronize'
  resource_name: string
  resource_source_type?: 'workflow' | 'environment'
  resource_source_oid?: string
  amount?: number
  target?: string
  source?: string
}

/**
 * Action specification in Trajectory schema format.
 */
export interface MasterActionSpecification extends ManagedElement {
  input_parameter_specifications?: ParameterSpecification[]
  output_parameter_specifications?: OutputParameterSpecification[]
  property_specifications?: PropertySpecification[]
  action_visibility?: 'opaque' | 'observable'
}

/**
 * Master Action Library in Trajectory schema format.
 */
export interface MasterActionLibrary extends ManagedElement {
  /** OID of this library's parent library (self-describing hierarchy; provenance only). */
  parent_library_oid?: string
  action_specifications: MasterActionSpecification[]
  child_libraries?: MasterActionLibrary[]
}

/**
 * Included action entry for environment specifications.
 *
 * The environment is the runtime contract — workflows run against environments,
 * not against an action library. An `IncludedAction` therefore carries the
 * full `MasterActionSpecification` shape inline (same field names as a
 * `.WFaction` file: `local_id`, `oid`, `description`, `version`,
 * `last_modified_date`, `input/output/property_specifications`,
 * `action_visibility`) so the package is self-contained for downstream
 * consumers (runtime, Action Server) that import these actions independently.
 *
 * `action_name` and `action_library` remain as the cross-package join keys —
 * `action_name` mirrors `local_id`; `action_library` identifies the source
 * library. The action body fields are populated when the action could be
 * resolved at export time and omitted otherwise (legacy/unresolved entries).
 */
export interface IncludedAction {
  /** Source action library name. Pairs with action_name as the cross-package join key. */
  action_library: string
  /** Action name. Mirrors `local_id` when the action body is resolved. */
  action_name: string
  // Inlined MasterActionSpecification — present when the action could be
  // resolved at export time. Field names match the .WFaction file format.
  local_id?: string
  oid?: string
  description?: string
  version?: string
  last_modified_date?: string
  input_parameter_specifications?: ParameterSpecification[]
  output_parameter_specifications?: OutputParameterSpecification[]
  property_specifications?: PropertySpecification[]
  action_visibility?: 'opaque' | 'observable'
}

/**
 * Resource property specification for environment specifications.
 */
export interface ResourcePropertySpecification {
  name: string
  resource_type:
    | 'binary exclusive use'
    | 'binary shared use with pool limits'
    | 'countable use with pool limits'
    | 'named pool'
    | 'sync'
  scope?: 'workflow' | 'environment'
  use_limit?: number
  description?: string
  names?: string[]
}

/**
 * Action server specification for environment specifications.
 */
export interface ActionServerSpecification {
  name: string
  uri: string
  description?: string
  connection_type: 'REST'
  api_key?: string
}

/**
 * Environment specification in Trajectory schema format.
 */
export interface MasterEnvironmentSpecification extends ManagedElement {
  library_name?: string
  /** OID of the environment library this spec lives in. */
  library_oid?: string
  /** Lifecycle state (Draft | InTest | InReview | Approved | Effective | Superseded | Obsolete). */
  state?: string
  included_actions: IncludedAction[]
  value_property_specifications?: PropertySpecification[]
  action_property_specifications?: PropertySpecification[]
  /** Designer-only Value Type templates; omitted from runtime packages. */
  value_type_specifications?: ValueTypeSpecification[]
  resource_property_specifications?: ResourcePropertySpecification[]
  action_server_specifications?: ActionServerSpecification[]
}

/**
 * Master Environment Library in Trajectory schema format.
 */
export interface MasterEnvironmentLibrary extends ManagedElement {
  /** OID of this library's parent library (self-describing hierarchy; provenance only). */
  parent_library_oid?: string
  environment_specifications: MasterEnvironmentSpecification[]
  child_libraries?: MasterEnvironmentLibrary[]
}

/**
 * Step type enum values in Trajectory schema format.
 */
export type StepType =
  | 'START'
  | 'END'
  | 'ACTION PROXY'
  | 'WORKFLOW PROXY'
  | 'SELECT 1'
  | 'WAIT ANY'
  | 'PARALLEL'
  | 'WAIT ALL'
  | 'SCRIPT'
  | 'GATE'
  | 'YES_NO'
  | 'USER_INTERACTION'
  | 'CATCH'
  | 'RETURN'

/**
 * Rich text content wrapper for Text/Header elements in export format.
 * `content` contains the HTML string with formatting and parameter placeholder chips.
 * `plainText` contains a stripped plain-text fallback for mobile runtimes that
 * don't support HTML rendering, with parameter placeholders restored to <name.key> syntax.
 */
export interface RichTextContent {
  content: string
  plainText: string
}

export interface FormLayoutExportEntry {
  deviceType: 'phone' | 'tablet' | 'desktop'
  canvasWidth: number
  canvasHeight: number
  elements: Array<Record<string, unknown>>
}

/**
 * Workflow step in Trajectory schema format.
 */
export interface MasterWorkflowStep extends ManagedElement {
  step_type: StepType
  resource_command_specifications?: ResourceCommandSpecification[]
  value_property_specifications?: PropertySpecification[]
  input_parameter_specifications?: ParameterSpecification[]
  output_parameter_specifications?: OutputParameterSpecification[]
  ui_parameter_specifications?: Array<{
    oid?: string
    type: string
    value: string
    font_size?: number
    color?: string
    lines?: number
    align?: string
    value2?: string
  }>
  yes_no_config?: {
    yes_label?: string
    no_label?: string
    yes_value?: string
    no_value?: string
    default_selection?: 'yes' | 'no' | 'none'
  }
  script_config?: {
    language?: string
    source?: string
    /** Spec 2026-10-13 §6.1: present = repeat until the script returns true. */
    repeat?: {
      cycle_seconds?: number
      /** Whole seconds, 1 ..= 31_449_600; absent = no time limit. */
      time_limit_seconds?: number
      /** Present exactly when time_limit_seconds is. */
      on_time_limit?: 'error' | 'complete'
    }
  }
  /** GATE step (spec 2026-08-29 §4): cyclic boolean transition. Everything optional —
   *  absent config means 5s cycle / no bindings / pass-through TRUE. */
  gate_config?: {
    cycle_seconds?: number
    language?: string
    source?: string
    /** Opt into armed behavior — the gate starts concurrently with the preceding
     *  Environment Action and stops it when the gate returns TRUE. Absent/false =
     *  the gate waits for the predecessor to complete (spec 2026-08-29 §5.3,
     *  amended 2026-08-30). */
    control_previous_action?: boolean
    /** Spec 2026-10-13 §3.1: absent = 'condition'. Emitted only for the two timed modes. */
    mode?: 'condition' | 'timer' | 'condition_or_timer'
    /** Whole seconds, 1 ..= 31_449_600; present exactly when mode is timed. */
    delay_seconds?: number
    action_property_bindings?: Array<{
      parameter_id: string
      environment_oid?: string
      environment_name?: string
      property: string
    }>
  }
  /** Spec 2026-09-04 §5.1: Action-Property bindings for a NON-GATE step (acquired once at
   *  step start by the engine). Derived at export by applyActionPropertyBindings from the
   *  step's property-typed inputs; never stored on the node. A GATE keeps its bindings in
   *  gate_config. */
  action_property_bindings?: Array<{
    parameter_id: string
    environment_oid?: string
    environment_name?: string
    property: string
  }>
  select1_config?: {
    input_name?: string
    input_value_type?: 'literal' | 'property'
    options?: Array<{
      id: string
      label: string
      operator: string
      value: string
      value_type: 'literal' | 'property'
      is_default: boolean
    }>
  }
  action_visibility?: 'opaque' | 'observable'
  /**
   * Runtime contract for ACTION PROXY steps: the action OID + environment OID the
   * runtime's binding flow needs to resolve a server URI and invoke the action.
   * Round-tripped verbatim through import/export so re-exported workflows remain
   * runnable; see workflow-importers.ts and workflow-exporters.ts for the import
   * extraction and three export sites that emit this field.
   */
  action_proxy_config?: {
    action_oid: string
    environment_oid: string
    timeout_ms?: number
    /** Optional (5.0+): the bound action's name — equal to the roster entry's action_name. */
    action_name?: string
    /** Optional (5.0+): the environment's name — equal to the embedded env spec's local_id. */
    environment_name?: string
  }
  connection_references?: string[]
  position?: { x: number; y: number }
  /** DEPRECATED (≤4.0, import-only). WYSIWYG form layout configuration — all 3 device breakpoints */
  form_layout_config?: FormLayoutExportEntry[]
  /** v2 Form Document (package format 5.0+) — the canonical FormDocument, verbatim.
   *  Replaces form_layout_config, which remains as a deprecated import-only field. */
  form_document?: FormDocument
  /** Stable image references for form elements — maps imageOid to filename for runtime resolution */
  form_element_images?: Array<{ image_oid: string; filename: string }>
  /** TRY/CATCH/RETURN: try specifications for ACTION PROXY steps (verbatim inner shape). */
  try_specifications?: Array<{ mode: 'ERROR' | 'ABORT' | 'TIMEOUT'; catch_id: string; release_on_catch?: boolean }>
  /** TRY/CATCH/RETURN: catch block identifier for CATCH steps. */
  catch_id?: string
  /** TRY/CATCH/RETURN: return configuration for RETURN steps (verbatim inner shape). */
  return_config?: {
    command: 'ABANDON' | 'RESTART' | 'GOTO' | 'RETRY' | 'COMPLETE'
    restart_mode?: 'CLEAN' | 'KEEP'
    goto_step_oid?: string
  }
}

/**
 * Master Workflow Step Library in Trajectory schema format.
 * Step library specs are complete workflows with nodes, edges, connections,
 * and recursively embedded child workflows — same structure as workflow libraries.
 */
export interface MasterWorkflowStepLibrary extends ManagedElement {
  /** OID of this library's parent library (self-describing hierarchy; provenance only). */
  parent_library_oid?: string
  workflow_specifications: MasterWorkflowSpecification[]
  child_libraries?: MasterWorkflowStepLibrary[]
}

/**
 * Workflow connection in Trajectory schema format.
 */
export interface WorkflowConnection {
  from_step_id: string
  to_step_id: string
  condition?: string
  connection_id?: string
  source_handle_id?: string
  waypoints?: { x: number; y: number }[]
}

/**
 * Master Workflow Specification in Trajectory schema format.
 */
export interface MasterWorkflowSpecification extends ManagedElement {
  schemaVersion?: SchemaVersion
  /** Optional ISA 88 type (e.g. 'Operation'); informational only. Omitted when unset. */
  type_name?: string
  display_style?: 'flowchart' | 'bpmn' | 'isa88'
  steps: MasterWorkflowStep[]
  connections: WorkflowConnection[]
  resource_command_specifications?: ResourceCommandSpecification[]
  resource_property_specifications?: ResourcePropertySpecification[]
  value_property_specifications?: PropertySpecification[]
  starting_parameter_specifications?: ParameterSpecification[]
  /** Workflow-level TRY fallback rows (spec 2026-08-22) — same entry shape as a step's. */
  try_specifications?: Array<{ mode: 'ERROR' | 'ABORT' | 'TIMEOUT'; catch_id: string; release_on_catch?: boolean }>
  output_parameter_specifications?: OutputParameterSpecification[]
  environment_specifications?: MasterEnvironmentSpecification[]
  /** Nested child workflow tree assembled from ChildSpecification records (new format, Phase 33+). */
  children?: ChildWorkflowExport[]
  viewport?: { x: number; y: number; zoom: number }
  /** Specification state — optional on root spec for backward compat with other export paths. */
  state?: string
  /** Name of the library this spec lives in (self-describing provenance). */
  library_name?: string
  /** OID of the library this spec lives in (self-describing provenance). */
  library_oid?: string
}

/**
 * A child workflow specification in the nested export tree.
 * Extends MasterWorkflowSpecification with required parent linkage and lifecycle fields.
 * Children are assembled from ChildSpecification records via the tree assembly logic.
 */
export interface ChildWorkflowExport extends MasterWorkflowSpecification {
  /** Links this child to its parent in the child tree (null = direct child of root). */
  parentChildSpecId: string | null
  /** Child spec version — always set for child exports (required, not optional). */
  version: string
  /** Child spec state — always set for child exports (required, not optional). */
  state: string
  /** Recursive nested grandchildren, omitted if empty. */
  children?: ChildWorkflowExport[]
}

/**
 * Master Workflow Library in Trajectory schema format.
 */
export interface MasterWorkflowLibrary extends ManagedElement {
  /** OID of this library's parent library (self-describing hierarchy; provenance only). */
  parent_library_oid?: string
  workflow_specifications: MasterWorkflowSpecification[]
  child_libraries?: MasterWorkflowLibrary[]
}

// =============================================================================
// Node Type Mapping
// =============================================================================

/** Node types whose steps may carry try_specifications — the single source of truth for the
 *  UI gate (NodeInlineEditor), export validation (workflow-validation), and all three export
 *  sites (workflow-exporters). Fixes the standing silent-drop: the export sites previously
 *  gated on actionProxyWait only while UI/validation allowed four types. workflowProxy joined
 *  2026-08-22 (workflow-level TRY fallback spec D3: escalated child failures route through
 *  the proxy's own TRY rows). */
export const TRY_CAPABLE_NODE_TYPES: ReadonlySet<string> = new Set([
  'actionProxyWait',
  'scriptStep',
  'gateStep',
  'userInteractionStep',
  'yesNoStep',
  'workflowProxy',
])

/**
 * Maps internal node types to Trajectory step types.
 */
export const NODE_TYPE_TO_STEP_TYPE: Record<NodeType, StepType> = {
  start: 'START',
  end: 'END',
  actionProxyWait: 'ACTION PROXY',
  yesNoStep: 'YES_NO',
  userInteractionStep: 'USER_INTERACTION',
  scriptStep: 'SCRIPT',
  gateStep: 'GATE',
  workflowProxy: 'WORKFLOW PROXY',
  select1: 'SELECT 1',
  waitAny: 'WAIT ANY',
  parallel: 'PARALLEL',
  waitAll: 'WAIT ALL',
  catch: 'CATCH',
  return: 'RETURN',
}
