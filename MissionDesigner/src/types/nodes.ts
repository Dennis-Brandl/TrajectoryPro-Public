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

import type { Node } from '@xyflow/react'
import type { FormDocument } from '@mission/form-schema'
import type { DurationParts } from '@/lib/duration'

/**
 * All step types supported by Trajectory workflows.
 */
export type NodeType =
  | 'start'
  | 'end'
  | 'actionProxyWait'
  | 'yesNoStep' // UI step type for binary selection
  | 'userInteractionStep' // v3.0 WYSIWYG form step type
  | 'scriptStep' // Script step type for Python script authoring
  | 'gateStep' // GATE — cyclic boolean transition step (spec 2026-08-29)
  | 'workflowProxy'
  | 'select1'
  | 'waitAny'
  | 'parallel'
  | 'waitAll'
  | 'catch'
  | 'return'

/**
 * Parameter specification for inputs and outputs.
 * Parameters are untyped strings with optional JSON schema validation.
 */
export interface ParameterSpec {
  /** Unique identifier for this parameter */
  id: string
  /** Parameter name (user-visible) */
  name: string
  /** Structured entries defining the parameter data shape (used in action definitions) */
  entries?: ValueEntrySpec[]
  /** Optional default/initial value */
  value?: string
  /** Whether value is a literal string or a value property reference */
  valueType?: 'literal' | 'property'
  /** Optional description */
  description?: string
  /** Optional JSON schema for validation */
  schema?: string
  /** Value property where this output is stored */
  target?: string
}

/**
 * Schema version for Trajectory workflow data.
 * v4.0: Legacy UI step types removed, clean 11-type NodeType union
 * v5.0: form_document (canonical v2 FormDocument) replaces form_layout_config
 */
export type SchemaVersion = '4.0' | '5.0'

/**
 * UI parameter types for Instruction Step and other UI-facing steps.
 * These determine the input control shown in properties panel and runtime rendering.
 */
export type UIParameterType =
  | 'Button'
  | 'Header'
  | 'Text'
  | 'SmallText'
  | 'Image'
  | 'Video'
  | 'TextInput'
  | 'YesNoButtons'
  | 'PickList'
  | 'CheckboxList'
  | 'FormField'
  | 'FormFieldMultiline'
  | 'FormFieldNumeric'
  | 'FormFieldPhone'
  | 'FormFieldEmail'
  | 'Divider'

/**
 * Discriminated union for UI step input parameters.
 * Each type has specific rendering requirements:
 * - Button, Image, Video: Single-line horizontally scrollable
 * - Header, Text, SmallText: Multi-line auto-growing textarea
 */
export type UIParameterSpec =
  | {
      id: string
      type: 'Button'
      value: string
    }
  | {
      id: string
      type: 'Header'
      value: string
      fontSize?: number
      color?: string
      align?: 'left' | 'center' | 'right'
    }
  | {
      id: string
      type: 'Text'
      value: string
      fontSize?: number
      color?: string
      align?: 'left' | 'center' | 'right'
    }
  | {
      id: string
      type: 'SmallText'
      value: string
      fontSize?: number
      color?: string
      align?: 'left' | 'center' | 'right'
    }
  | {
      id: string
      type: 'Image'
      value: string
    }
  | {
      id: string
      type: 'Video'
      value: string
    }
  | {
      id: string
      type: 'TextInput'
      value: string
      lines?: number
    }
  | {
      id: string
      type: 'YesNoButtons'
      value: string
      value2: string
    }
  | {
      id: string
      type: 'PickList'
      value: string
    }
  | {
      id: string
      type: 'CheckboxList'
      value: string
    }
  | {
      id: string
      type: 'FormField'
      value: string
    }
  | {
      id: string
      type: 'FormFieldMultiline'
      value: string
      lines?: number
    }
  | {
      id: string
      type: 'FormFieldNumeric'
      value: string
    }
  | {
      id: string
      type: 'FormFieldPhone'
      value: string
    }
  | {
      id: string
      type: 'FormFieldEmail'
      value: string
    }
  | {
      id: string
      type: 'Divider'
      value: string
    }

/**
 * A single name/value entry within a value property.
 */
export interface ValueEntrySpec {
  /** Unique identifier for this entry */
  id: string
  /** Entry name (e.g. "Value", "Description", or custom) */
  name: string
  /** Entry value */
  value: string
}

/**
 * Value property specification.
 * Named value properties with multiple name/value entries.
 * Each property has default "Value" and "Description" entries,
 * plus optional custom entries. References use dot notation: PropertyName.EntryName
 */
export interface ValueSpec {
  /** Unique identifier for this property */
  id: string
  /** Property name (user-visible, e.g. "UserResponse") */
  name: string
  /** Name/value pair entries */
  entries: ValueEntrySpec[]
}

/**
 * Entry template inside a Value Type.
 */
export interface ValueTypeEntrySpec {
  /** Unique identifier for this entry */
  id: string
  /** Entry name (e.g. "Name", "Address") */
  name: string
  /** Optional default value copied into properties created from this type */
  defaultValue?: string
}

/**
 * Value Type specification — a named entry template defined on an environment.
 * Designer-only authoring convenience: creating a Value Property "from" a Value
 * Type copies these entries into the property. No link is retained afterward,
 * and Value Types never appear in runtime-facing exports.
 */
export interface ValueTypeSpec {
  /** Unique identifier for this Value Type */
  id: string
  /** Type name (user-visible, e.g. "CustomerInfo"); dot/space-sanitized */
  name: string
  /** Optional description shown in the creation picker */
  description?: string
  /** Entry templates copied into new properties */
  entries: ValueTypeEntrySpec[]
}

/**
 * Resource type for environment resource specifications.
 */
export type ResourceType = 'Single Use' | 'Shared Use' | 'Count Limited' | 'Named' | 'Sync'

/**
 * Resource property specification for environment specifications.
 * Defines resources that can be accessed/claimed during workflow execution.
 */
export interface ResourceSpec {
  /** Unique identifier for this resource */
  id: string
  /** Resource name (user-visible) */
  name: string
  /** Optional description */
  description?: string
  /** Resource access type */
  resourceType: ResourceType
  /** Count/limit for the resource (fixed at 1 for Single Use) */
  count: number
  /** Named pool: list of named strings (only for Named type) */
  names?: string[]
}

/**
 * Connection type for action servers.
 */
export type ActionServerConnectionType = 'REST'

/**
 * Action server specification for environment specifications.
 * Defines a registered server that can execute actions.
 */
export interface ActionServerSpec {
  /** Unique identifier for this server */
  id: string
  /** Display name of the server */
  name: string
  /** URI endpoint */
  uri: string
  /** Optional description */
  description?: string
  /** Connection protocol */
  connectionType: ActionServerConnectionType
  /** Optional API key used to authenticate with the server */
  apiKey?: string
}

/**
 * Command type for step resource commands.
 */
export type ResourceCommandType = 'Acquire' | 'Release' | 'Send' | 'Receive' | 'Synchronize'

/**
 * Resource command specification for workflow steps.
 * Defines resource acquisition/release during step execution.
 */
export interface StepResourceCommand {
  /** Unique identifier for this command */
  id: string
  /** Name of the resource (must match an available resource) */
  resourceName: string
  /** Whether the resource is defined on a workflow or an environment */
  resourceSourceType?: 'workflow' | 'environment'
  /** OID of the workflow or environment that defines the resource */
  resourceSourceOid?: string
  /** Command type: Acquire or Release */
  commandType: ResourceCommandType
  /** Count for Count Limited resources (default 1) */
  count: number
  /** Value property ref for storing the acquired named resource (Named type only) */
  target?: string
  /** Value property ref or literal for the data to send (Sync Send only) */
  source?: string
}

/**
 * Comparison operators for Select 1 step type.
 */
export type Select1Operator = '==' | '!=' | '<' | '>' | '<=' | '>=' | 'Contains' | 'Not Contains'

/**
 * Option specification for Select 1 step type.
 * Each option defines a comparison condition and maps to one output handle.
 * The id serves triple duty: stable UUID, Handle ID, and connection_id.
 */
export interface Select1OptionSpec {
  id: string
  label: string
  operator: Select1Operator
  value: string
  valueType: 'literal' | 'property'
  isDefault: boolean
}

/** TRY row shape — shared verbatim by step-level `trySpecifications` and the workflow-level
 *  `workflowTrySpecifications` (exported as `try_specifications` at both levels). */
export interface TrySpec {
  mode: 'ERROR' | 'ABORT' | 'TIMEOUT'
  catch_id: string
  release_on_catch?: boolean
}

/**
 * Data payload for all workflow step nodes.
 */
export interface StepNodeData extends Record<string, unknown> {
  /** Display label shown on the node */
  label: string

  /** Step type determines visual rendering */
  stepType: NodeType

  /** Optional description for documentation/tooltips */
  description?: string

  /** Input parameter specifications */
  inputs?: ParameterSpec[]

  /** Output parameter specifications */
  outputs?: ParameterSpec[]

  /** Value property specifications */
  values?: ValueSpec[]

  /** Resource commands for acquiring/releasing resources */
  resourceCommands?: StepResourceCommand[]

  /** UI-specific parameters for Yes/No and User Interaction step types */
  uiParameters?: UIParameterSpec[]

  /** Yes/No specific: output value when Yes is selected (default: "true") */
  yesNoYesValue?: string

  /** Yes/No specific: output value when No is selected (default: "false") */
  yesNoNoValue?: string

  /** Yes/No specific: default selection (yes/no/none) */
  yesNoDefaultSelection?: 'yes' | 'no' | 'none'

  /** User Interaction / Yes/No step: the step's form, authored in the v2 editor. */
  formDocument?: FormDocument

  /** Select 1: name of the input parameter to compare */
  select1InputName?: string

  /** Select 1: whether input name is a literal string or value property reference */
  select1InputValueType?: 'literal' | 'property'

  /** Select 1: comparison options (one per outgoing connection) */
  select1Options?: Select1OptionSpec[]

  /** ISA88: persisted horizontal width for control nodes (default: 120) */
  isa88Width?: number

  /** ISA88: dynamic target handle IDs for convergence nodes (WaitAny, WaitAll) */
  isa88TargetHandles?: string[]

  /** ISA88: dynamic source handle IDs for divergence nodes (Parallel) */
  isa88SourceHandles?: string[]

  /** Script step: source code */
  scriptSource?: string

  /** Script step: language identifier (e.g. 'javascript') */
  scriptLanguage?: string

  /** Script step (spec 2026-10-13 §6): re-run every cycle until the script returns true. */
  scriptRepeat?: boolean

  /** Repeating script: seconds between runs (default 5, min 1). */
  scriptCycleSeconds?: number

  /** Repeating script: optional time limit as typed into the five boxes; a zero total = no limit. */
  scriptTimeLimit?: DurationParts

  /** Repeating script: at the time limit, fail the step (absent/'error') or complete with current outputs. */
  scriptOnTimeLimit?: 'error' | 'complete'

  /** Gate step: evaluation cycle in seconds (default 5, min 1). */
  gateCycleSeconds?: number

  /** Gate step: when true, the gate starts concurrently with the preceding Environment
   *  Action and stops it when the gate returns TRUE. Default/absent = false (the gate
   *  waits for the previous step to complete). */
  gateControlPreviousAction?: boolean

  /** Gate step (spec 2026-10-13): absent = 'condition'. 'timer' opens after gateDelay;
   *  'condition_or_timer' opens on TRUE or after gateDelay, whichever first. */
  gateMode?: 'condition' | 'timer' | 'condition_or_timer'

  /** Gate step: the timed modes' delay, as typed into the five boxes. Exported as seconds. */
  gateDelay?: DurationParts

  /** Environment spec this action is scoped to (design-time UX convenience, not exported) */
  environmentSpecId?: string

  /** Action reference name (for environment actions) */
  actionName?: string

  /** Action library name (for environment actions) */
  actionLibraryName?: string

  /** Action visibility: opaque (internal) or observable (visible to caller) */
  actionVisibility?: 'opaque' | 'observable'

  /**
   * Raw `action_proxy_config` round-tripped through import/export for `actionProxyWait` steps.
   * The runtime needs `action_oid` + `environment_oid` on every ACTION PROXY step to
   * resolve which action server to invoke; the editor's UI normally edits actions via
   * the design-time `actionName`/`actionLibraryName`/`environmentSpecId` fields, but
   * the runtime contract is OID-based and must be preserved verbatim through any
   * import → DB → export cycle. Without this field, exported workflows lose the
   * proxy target and the runtime's `environmentsNeedingBinding()` reports no envs.
   */
  actionProxyConfig?: {
    action_oid: string
    environment_oid: string
    timeout_ms?: number
    /** Optional (5.0+): the bound action's name — equal to the roster entry's action_name. */
    action_name?: string
    /** Optional (5.0+): the environment's name — equal to the embedded env spec's local_id. */
    environment_name?: string
  }

  /** TRY specifications on ACTION PROXY steps (camelCase editor side; exported as try_specifications; see `TrySpec`). */
  trySpecifications?: TrySpec[]

  /** CATCH step's catch_id (the handle TRY entries reference). */
  catchId?: string

  /** RETURN step's command config (exported as return_config). */
  returnConfig?: {
    command: 'ABANDON' | 'RESTART' | 'GOTO' | 'RETRY' | 'COMPLETE'
    restart_mode?: 'CLEAN' | 'KEEP'
    goto_step_oid?: string
  }

  /** Sub-workflow mode: 'embedded' (new/copy) or 'reference' */
  subWorkflowMode?: 'embedded' | 'reference'

  /** For embedded mode: UUID of the created workflow specification */
  embeddedWorkflowSpecId?: string

  /** For reference mode: UUID of the referenced library step specification */
  referencedStepSpecId?: string

  /** For reference mode: UUID of the referenced library step's library */
  referencedStepLibraryId?: string

  /** For reference mode: Name of the referenced step (for display if deleted) */
  referencedStepName?: string
}

/**
 * A workflow node is a React Flow Node with StepNodeData and NodeType.
 */
export type WorkflowNode = Node<StepNodeData, NodeType>
