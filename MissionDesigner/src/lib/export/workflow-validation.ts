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
import { joinDuration, MAX_DELAY_SECONDS } from '@/lib/duration'
import type {
  WorkflowNode,
  StepNodeData,
  ParameterSpec,
  ValueSpec,
  ResourceSpec,
  StepResourceCommand,
  Select1OptionSpec,
  TrySpec,
} from '@/types/nodes'
import type { Specification } from '@/types/library'
import { partitionCatchNetworks, type PartitionStep } from '@/lib/canvas/catch-network-partition'
import { checkNeverStuck } from '@mission/form-schema'
import { stepKindOfNode } from '@/lib/form-document/step-kind'
import { NODE_TYPE_TO_STEP_TYPE, TRY_CAPABLE_NODE_TYPES } from '@/lib/packageFormat/export-types'

export interface ValidationError {
  nodeId: string
  nodeName: string
  nodeType: string
  workflowName?: string
  message: string
}

interface ConnectionRules {
  minIncoming: number
  maxIncoming: number
  minOutgoing: number
  maxOutgoing: number
}

const NODE_RULES: Record<string, ConnectionRules> = {
  start: { minIncoming: 0, maxIncoming: 0, minOutgoing: 1, maxOutgoing: 1 },
  end: { minIncoming: 1, maxIncoming: Infinity, minOutgoing: 0, maxOutgoing: 0 },
  catch: { minIncoming: 0, maxIncoming: 0, minOutgoing: 1, maxOutgoing: 1 },
  return: { minIncoming: 1, maxIncoming: Infinity, minOutgoing: 0, maxOutgoing: 0 },
  actionProxyWait: { minIncoming: 1, maxIncoming: 1, minOutgoing: 1, maxOutgoing: 1 },
  userInteractionStep: { minIncoming: 1, maxIncoming: 1, minOutgoing: 1, maxOutgoing: 1 },
  scriptStep: { minIncoming: 1, maxIncoming: 1, minOutgoing: 1, maxOutgoing: 1 },
  gateStep: { minIncoming: 1, maxIncoming: 1, minOutgoing: 1, maxOutgoing: 1 },
  workflowProxy: { minIncoming: 1, maxIncoming: 1, minOutgoing: 1, maxOutgoing: 1 },
  yesNoStep: { minIncoming: 1, maxIncoming: 1, minOutgoing: 2, maxOutgoing: 2 },
  select1: { minIncoming: 1, maxIncoming: 1, minOutgoing: 1, maxOutgoing: Infinity },
  parallel: { minIncoming: 1, maxIncoming: 1, minOutgoing: 1, maxOutgoing: Infinity },
  waitAny: { minIncoming: 1, maxIncoming: Infinity, minOutgoing: 1, maxOutgoing: 1 },
  waitAll: { minIncoming: 1, maxIncoming: Infinity, minOutgoing: 1, maxOutgoing: 1 },
}

/** Words JavaScript never allows as a parameter name (sloppy mode, which is how the engine
 *  compiles Script and Gate source). */
const RESERVED_WORDS = new Set([
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'null',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
])

const IDENTIFIER = /^[\p{ID_Start}$_][\p{ID_Continue}$\u200C\u200D]*$/u

/** Why `name` cannot be a Script/Gate input (the engine passes each input to the script as a
 *  local variable of that name), or null when it can. */
export function scriptInputNameProblem(name: string): string | null {
  if (RESERVED_WORDS.has(name)) return `Input parameter "${name}" is a reserved JavaScript word; rename it`
  if (!IDENTIFIER.test(name)) {
    return `Input parameter "${name || '(blank)'}" is not a valid script variable name: use letters, digits, _ or $, and do not start with a digit`
  }
  return null
}

export function validateWorkflow(
  nodes: WorkflowNode[],
  edges: Edge[],
  workflowTrySpecs: TrySpec[] = [],
): ValidationError[] {
  const errors: ValidationError[] = []

  // Build edge count maps
  const incomingCount = new Map<string, number>()
  const outgoingCount = new Map<string, number>()
  const outgoingEdges = new Map<string, Edge[]>()

  for (const node of nodes) {
    incomingCount.set(node.id, 0)
    outgoingCount.set(node.id, 0)
    outgoingEdges.set(node.id, [])
  }

  for (const edge of edges) {
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1)
    outgoingCount.set(edge.source, (outgoingCount.get(edge.source) ?? 0) + 1)
    const existing = outgoingEdges.get(edge.source) ?? []
    existing.push(edge)
    outgoingEdges.set(edge.source, existing)
  }

  // Check exactly one Start node
  const startNodes = nodes.filter((n) => n.type === 'start')
  if (startNodes.length === 0) {
    errors.push({ nodeId: '', nodeName: '', nodeType: 'start', message: 'Workflow must contain a Start node' })
  } else if (startNodes.length > 1) {
    for (const node of startNodes.slice(1)) {
      errors.push({
        nodeId: node.id,
        nodeName: (node.data as { label?: string })?.label || node.id,
        nodeType: 'start',
        message: 'Workflow must contain exactly one Start node',
      })
    }
  }

  // Check each node against rules
  for (const node of nodes) {
    const nodeType = node.type || 'unknown'
    const rules = NODE_RULES[nodeType]
    if (!rules) continue

    const nodeName = (node.data as { label?: string })?.label || node.id
    const incoming = incomingCount.get(node.id) ?? 0
    const outgoing = outgoingCount.get(node.id) ?? 0

    // Check disconnected nodes (no edges at all)
    if (incoming === 0 && outgoing === 0 && nodeType !== 'start' && nodeType !== 'end' && nodeType !== 'catch') {
      errors.push({
        nodeId: node.id,
        nodeName,
        nodeType,
        message: 'Node is disconnected (no incoming or outgoing connections)',
      })
      continue
    }

    // Incoming checks
    if (incoming < rules.minIncoming) {
      errors.push({
        nodeId: node.id,
        nodeName,
        nodeType,
        message: `Requires at least ${rules.minIncoming} incoming connection(s), has ${incoming}`,
      })
    }
    if (incoming > rules.maxIncoming) {
      errors.push({
        nodeId: node.id,
        nodeName,
        nodeType,
        message: `Allows at most ${rules.maxIncoming} incoming connection(s), has ${incoming}`,
      })
    }

    // Outgoing checks
    if (outgoing < rules.minOutgoing) {
      errors.push({
        nodeId: node.id,
        nodeName,
        nodeType,
        message: `Requires at least ${rules.minOutgoing} outgoing connection(s), has ${outgoing}`,
      })
    }
    if (outgoing > rules.maxOutgoing) {
      errors.push({
        nodeId: node.id,
        nodeName,
        nodeType,
        message: `Allows at most ${rules.maxOutgoing} outgoing connection(s), has ${outgoing}`,
      })
    }

    // Yes/No step: must have exactly one YES and one NO edge (via sourceHandle)
    if (nodeType === 'yesNoStep' && outgoing === 2) {
      const nodeEdges = outgoingEdges.get(node.id) ?? []
      const hasYes = nodeEdges.some((e) => e.sourceHandle === 'yes')
      const hasNo = nodeEdges.some((e) => e.sourceHandle === 'no')
      if (!hasYes) {
        errors.push({ nodeId: node.id, nodeName, nodeType, message: 'Missing YES branch connection' })
      }
      if (!hasNo) {
        errors.push({ nodeId: node.id, nodeName, nodeType, message: 'Missing NO branch connection' })
      }
    }

    // Select 1 step: must have a default comparison option set
    if (nodeType === 'select1') {
      const options = ((node.data as StepNodeData).select1Options ?? []) as Select1OptionSpec[]
      const hasDefault = options.some((o) => o.isDefault)
      if (!hasDefault) {
        errors.push({ nodeId: node.id, nodeName, nodeType, message: 'Missing default SELECT 1 comparison option' })
      }
    }

    // Timed gate (spec 2026-10-13 §3.2): the engine refuses a missing or out-of-range delay.
    if (nodeType === 'gateStep') {
      const d = node.data as StepNodeData
      if (d.gateMode === 'timer' || d.gateMode === 'condition_or_timer') {
        const secs = joinDuration(d.gateDelay)
        if (secs < 1) {
          errors.push({ nodeId: node.id, nodeName, nodeType, message: 'Timed gate needs a delay of at least 1 second' })
        } else if (secs > MAX_DELAY_SECONDS) {
          errors.push({
            nodeId: node.id,
            nodeName,
            nodeType,
            message: 'Timed gate delay cannot be longer than 52 weeks',
          })
        }
      }
    }

    // Script and Gate inputs become local variables in the script, so each name must be one.
    // A timer-only gate never runs its script, so its inputs are not checked.
    const runsScript =
      nodeType === 'scriptStep' || (nodeType === 'gateStep' && (node.data as StepNodeData).gateMode !== 'timer')
    if (runsScript) {
      for (const input of ((node.data as StepNodeData).inputs ?? []) as ParameterSpec[]) {
        const problem = scriptInputNameProblem(input.name)
        if (problem) errors.push({ nodeId: node.id, nodeName, nodeType, message: problem })
      }
    }

    // Repeating script (spec 2026-10-13 §6.1): the engine refuses a time limit over 52 weeks.
    if (nodeType === 'scriptStep') {
      const d = node.data as StepNodeData
      if (d.scriptRepeat === true && joinDuration(d.scriptTimeLimit) > MAX_DELAY_SECONDS) {
        errors.push({
          nodeId: node.id,
          nodeName,
          nodeType,
          message: 'Script time limit cannot be longer than 52 weeks',
        })
      }
    }
  }

  // Forms with job buttons must never leave the operator stuck (spec 2026-10-28 section 5.4).
  for (const node of nodes) {
    if (node.type !== 'userInteractionStep' && node.type !== 'yesNoStep') continue
    const formDocument = (node.data as StepNodeData).formDocument
    if (!formDocument) continue
    for (const problem of checkNeverStuck(formDocument, stepKindOfNode(node.type))) {
      errors.push({
        nodeId: node.id,
        nodeName: (node.data as { label?: string })?.label || node.id,
        nodeType: node.type,
        message: `Form buttons: ${problem.message}`,
      })
    }
  }

  errors.push(...validateTryCatchReturn(nodes, edges, workflowTrySpecs))
  return errors
}

function validateTryCatchReturn(nodes: WorkflowNode[], edges: Edge[], workflowTrySpecs: TrySpec[]): ValidationError[] {
  const errors: ValidationError[] = []
  const err = (n: WorkflowNode, message: string): ValidationError => ({
    nodeId: n.id,
    nodeName: (n.data as { label?: string }).label || n.id,
    nodeType: n.type || 'unknown',
    message,
  })

  const catchNodes = nodes.filter((n) => n.type === 'catch')
  const catchIds = new Map<string, WorkflowNode[]>()
  for (const c of catchNodes) {
    const id = (c.data as { catchId?: string }).catchId
    if (!id) {
      errors.push(err(c, 'CATCH has no catch_id'))
      continue
    }
    const list = catchIds.get(id) ?? []
    list.push(c)
    catchIds.set(id, list)
  }
  for (const [id, list] of catchIds) {
    if (list.length > 1)
      for (const c of list) errors.push(err(c, `Duplicate catch_id "${id}" — each CATCH must be unique`))
  }

  const steps: PartitionStep[] = nodes.map((n) => ({
    oid: n.id,
    step_type: NODE_TYPE_TO_STEP_TYPE[(n.type ?? 'start') as keyof typeof NODE_TYPE_TO_STEP_TYPE] ?? 'UNKNOWN',
    catch_id: (n.data as { catchId?: string }).catchId,
  }))
  const conns = edges.map((e) => ({ from_step_id: e.source, to_step_id: e.target }))
  const part = partitionCatchNetworks(steps, conns)

  for (const c of catchNodes) {
    const id = (c.data as { catchId?: string }).catchId
    if (id && !part.networksByCatchId.has(id)) errors.push(err(c, 'CATCH network has no reachable RETURN'))
  }

  const knownCatchIds = new Set([...catchIds.keys()])
  for (const n of nodes) {
    const ts = (n.data as { trySpecifications?: Array<{ mode: string; catch_id: string }> }).trySpecifications
    if (!Array.isArray(ts) || ts.length === 0) continue
    if (!TRY_CAPABLE_NODE_TYPES.has(n.type as string)) {
      errors.push(
        err(n, 'TRY is only allowed on Action Proxy, Script, User Interaction, Yes/No, or Workflow Proxy steps'),
      )
      continue
    }
    const seenModes = new Set<string>()
    for (const t of ts) {
      if (seenModes.has(t.mode)) errors.push(err(n, `Duplicate TRY mode "${t.mode}" on this step`))
      seenModes.add(t.mode)
      if (!knownCatchIds.has(t.catch_id))
        errors.push(err(n, `TRY ON ${t.mode} references unknown catch_id "${t.catch_id}"`))
    }
  }

  // Workflow-level rows (spec 2026-08-22): same mode/catch rules, anchored to a synthetic
  // 'workflow' entry since there is no node to point at.
  const wfErr = (message: string): ValidationError => ({
    nodeId: '',
    nodeName: 'Workflow',
    nodeType: 'workflow',
    message,
  })
  const seenWfModes = new Set<string>()
  for (const t of workflowTrySpecs) {
    if (seenWfModes.has(t.mode)) errors.push(wfErr(`Duplicate workflow-level TRY mode "${t.mode}"`))
    seenWfModes.add(t.mode)
    if (!knownCatchIds.has(t.catch_id))
      errors.push(wfErr(`Workflow TRY ON ${t.mode} references unknown catch_id "${t.catch_id}"`))
  }

  const nodeIdSet = new Set(nodes.map((x) => x.id))
  for (const n of nodes.filter((x) => x.type === 'return')) {
    const rc = (n.data as { returnConfig?: { command?: string; restart_mode?: string; goto_step_oid?: string } })
      .returnConfig
    if (rc?.command === 'RESTART' && !rc.restart_mode)
      errors.push(err(n, 'RETURN RESTART requires a restart mode (CLEAN or KEEP)'))
    if (rc?.command === 'GOTO') {
      if (!rc.goto_step_oid) {
        errors.push(err(n, 'RETURN GOTO requires a target step'))
      } else if (!nodeIdSet.has(rc.goto_step_oid)) {
        // The target step was deleted/recreated after the GOTO was wired, leaving a dangling
        // reference (goto_step_oid no longer matches any step). Exporting it would strand the
        // workflow at runtime (RUNNING, no active steps), so block it here and have the user
        // re-select a current target step. Mirrors the runtime GOTO_TARGET_NOT_FOUND check.
        errors.push(err(n, 'RETURN GOTO target step no longer exists — re-select the target step'))
      } else if (part.catchNetworkStepOids.has(rc.goto_step_oid)) {
        errors.push(err(n, `GOTO target "${rc.goto_step_oid}" is inside a catch network`))
      }
    }
  }
  return errors
}

/**
 * Build the set of valid value property references available to a workflow spec.
 * Includes: workflow-level values + entries (dot notation), workflow input/output param names,
 * environment values, and parent workflow values (walking up the hierarchy).
 */
function buildValidRefs(specData: Record<string, unknown>, allSpecs: Specification[]): Set<string> {
  const refs = new Set<string>()

  const addValues = (values: ValueSpec[] | undefined) => {
    if (!values) return
    for (const v of values) {
      if (!v.name) continue
      refs.add(v.name)
      for (const e of v.entries) {
        if (e.name) refs.add(`${v.name}.${e.name}`)
      }
    }
  }

  const addParams = (params: ParameterSpec[] | undefined) => {
    if (!params) return
    for (const p of params) {
      if (p.name) refs.add(p.name)
    }
  }

  // Current workflow values, inputs, outputs
  addValues(specData.workflowValues as ValueSpec[] | undefined)
  addParams(specData.workflowInputs as ParameterSpec[] | undefined)
  addParams(specData.workflowOutputs as ParameterSpec[] | undefined)

  // Environment values
  const envSpecIds = (specData.environmentSpecIds ?? []) as string[]
  for (const envId of envSpecIds) {
    const envSpec = allSpecs.find((s) => s.id === envId)
    if (!envSpec) continue
    const envData = envSpec.data as Record<string, unknown>
    addValues(envData.values as ValueSpec[] | undefined)
    addValues(envData.value_property_specifications as ValueSpec[] | undefined)
    // Spec 2026-09-04 §5.3: environment Action Properties are valid input sources (Group and
    // Group.Entry — the same dotted shape addValues produces for Value Properties).
    addValues(envData.actionProperties as ValueSpec[] | undefined)
  }

  // Step-level outputs (available as sources for other steps)
  const nodes = (specData.nodes ?? []) as WorkflowNode[]
  for (const node of nodes) {
    const nd = node.data as StepNodeData
    addParams(nd.outputs)
  }

  // Walk up parent chain
  let parentId = specData.parentSpecificationId as string | undefined
  while (parentId) {
    const parentSpec = allSpecs.find((s) => s.id === parentId)
    if (!parentSpec) break
    const pd = parentSpec.data as Record<string, unknown>
    addValues(pd.workflowValues as ValueSpec[] | undefined)
    addParams(pd.workflowInputs as ParameterSpec[] | undefined)
    addParams(pd.workflowOutputs as ParameterSpec[] | undefined)
    // Parent environments' Action Properties are in scope too (the picker walks the parent chain).
    for (const envId of (pd.environmentSpecIds ?? []) as string[]) {
      const envSpec = allSpecs.find((s) => s.id === envId)
      if (!envSpec) continue
      addValues((envSpec.data as Record<string, unknown>).actionProperties as ValueSpec[] | undefined)
    }
    parentId = pd.parentSpecificationId as string | undefined
  }

  return refs
}

/**
 * Build the set of valid resource names available to a workflow spec.
 * Includes: workflow-level resources and environment resources.
 */
function buildValidResources(specData: Record<string, unknown>, allSpecs: Specification[]): Map<string, ResourceSpec> {
  const resources = new Map<string, ResourceSpec>()

  const addResources = (list: ResourceSpec[] | undefined) => {
    if (!list) return
    for (const r of list) {
      if (r.name && !resources.has(r.name)) resources.set(r.name, r)
    }
  }

  // Current workflow resources
  addResources(specData.workflowResources as ResourceSpec[] | undefined)

  // Environment resources
  const envSpecIds = (specData.environmentSpecIds ?? []) as string[]
  for (const envId of envSpecIds) {
    const envSpec = allSpecs.find((s) => s.id === envId)
    if (!envSpec) continue
    const envData = envSpec.data as Record<string, unknown>
    addResources(envData.resources as ResourceSpec[] | undefined)
  }

  // Walk up parent chain
  let parentId = specData.parentSpecificationId as string | undefined
  while (parentId) {
    const parentSpec = allSpecs.find((s) => s.id === parentId)
    if (!parentSpec) break
    const pd = parentSpec.data as Record<string, unknown>
    addResources(pd.workflowResources as ResourceSpec[] | undefined)
    const parentEnvIds = (pd.environmentSpecIds ?? []) as string[]
    for (const envId of parentEnvIds) {
      const envSpec = allSpecs.find((s) => s.id === envId)
      if (!envSpec) continue
      addResources((envSpec.data as Record<string, unknown>).resources as ResourceSpec[] | undefined)
    }
    parentId = pd.parentSpecificationId as string | undefined
  }

  return resources
}

/**
 * Build the set of valid (action library, action name) pairs available to a
 * workflow spec via its attached environment specifications (and the
 * environments inherited up the parent chain). Each environment's
 * `included_actions` array lists the actions it makes available; the key is
 * `${actionLibrary}::${actionName}` so we can verify both halves at once.
 *
 * Tolerates both `included_actions` / `includedActions` and
 * `action_library` / `actionLibrary` field-name variants — the schema settled
 * on snake_case but older specs may carry camelCase.
 */
function buildValidEnvironmentActions(specData: Record<string, unknown>, allSpecs: Specification[]): Set<string> {
  const keys = new Set<string>()

  const addFromEnv = (envData: Record<string, unknown>) => {
    const actions = (envData.included_actions ?? envData.includedActions ?? []) as Array<{
      action_library?: string
      actionLibrary?: string
      action_name?: string
      actionName?: string
    }>
    for (const a of actions) {
      const lib = a.action_library ?? a.actionLibrary
      const name = a.action_name ?? a.actionName
      if (lib && name) keys.add(`${lib}::${name}`)
    }
  }

  const walkEnvIds = (envSpecIds: string[]) => {
    for (const envId of envSpecIds) {
      const envSpec = allSpecs.find((s) => s.id === envId)
      if (!envSpec) continue
      addFromEnv(envSpec.data as Record<string, unknown>)
    }
  }

  walkEnvIds((specData.environmentSpecIds ?? []) as string[])

  // Inherited environments via the parent workflow chain (mirrors
  // buildValidResources's parent-walk).
  let parentId = specData.parentSpecificationId as string | undefined
  while (parentId) {
    const parentSpec = allSpecs.find((s) => s.id === parentId)
    if (!parentSpec) break
    const pd = parentSpec.data as Record<string, unknown>
    walkEnvIds((pd.environmentSpecIds ?? []) as string[])
    parentId = pd.parentSpecificationId as string | undefined
  }

  return keys
}

/**
 * Validates parameter references and resource commands in a workflow.
 * Checks that all source/destination references resolve to valid targets.
 */
function validateReferences(
  nodes: WorkflowNode[],
  specData: Record<string, unknown>,
  allSpecs: Specification[],
  workflowName?: string,
): ValidationError[] {
  const errors: ValidationError[] = []
  const validRefs = buildValidRefs(specData, allSpecs)
  const validResources = buildValidResources(specData, allSpecs)
  const validEnvActions = buildValidEnvironmentActions(specData, allSpecs)

  for (const node of nodes) {
    const data = node.data as StepNodeData
    const nodeName = data.label || node.id
    const nodeType = node.type || 'unknown'
    const makeError = (message: string): ValidationError => ({
      nodeId: node.id,
      nodeName,
      nodeType,
      workflowName,
      message,
    })

    // 1. Input parameters with source mode — check value reference is valid
    const inputs = (data.inputs ?? []) as ParameterSpec[]
    for (const input of inputs) {
      if (input.valueType === 'property' && input.value) {
        if (!validRefs.has(input.value)) {
          errors.push(
            makeError(
              `Input "${input.name}" source "${input.value}" does not resolve to a known value property or parameter`,
            ),
          )
        }
      }
    }

    // 2. Output parameters with target — check destination is valid
    const outputs = (data.outputs ?? []) as ParameterSpec[]
    for (const output of outputs) {
      if (output.target) {
        if (!validRefs.has(output.target)) {
          errors.push(
            makeError(
              `Output "${output.name}" destination "${output.target}" does not resolve to a known value property or parameter`,
            ),
          )
        }
      }
    }

    // 3a. actionProxyWait node — must reference a real environment action.
    //     Each attached environment exposes `included_actions: [{action_library, action_name}, ...]`;
    //     the node's actionLibraryName/actionName must match an entry in one of
    //     those (or in an environment inherited up the parent-workflow chain).
    if (nodeType === 'actionProxyWait') {
      const actionName = data.actionName?.trim()
      const actionLibraryName = data.actionLibraryName?.trim()
      if (!actionName || !actionLibraryName) {
        errors.push(
          makeError('Action step has no action selected — pick an action from one of the attached environments'),
        )
      } else if (!validEnvActions.has(`${actionLibraryName}::${actionName}`)) {
        errors.push(
          makeError(
            `Action reference "${actionName}" from library "${actionLibraryName}" is not provided by any attached environment`,
          ),
        )
      }
    }

    // 3. Resource commands — check resource name exists
    const commands = (data.resourceCommands ?? []) as StepResourceCommand[]
    for (const cmd of commands) {
      if (cmd.resourceName && !validResources.has(cmd.resourceName)) {
        errors.push(makeError(`Resource command references "${cmd.resourceName}" which is not a defined resource`))
      }

      // 4. Named resource Acquire/Release — must have target set and valid
      if (cmd.resourceName) {
        const resSpec = validResources.get(cmd.resourceName)
        if (resSpec?.resourceType === 'Named') {
          if (cmd.commandType === 'Acquire') {
            if (!cmd.target) {
              errors.push(
                makeError(
                  `Acquire of named resource "${cmd.resourceName}" has no "Store acquired name to" destination`,
                ),
              )
            } else if (!validRefs.has(cmd.target)) {
              errors.push(
                makeError(
                  `Acquire of named resource "${cmd.resourceName}" target "${cmd.target}" does not resolve to a known value property`,
                ),
              )
            }
          }
          if (cmd.commandType === 'Release') {
            if (!cmd.target) {
              errors.push(
                makeError(`Release of named resource "${cmd.resourceName}" has no "Release resource stored in" source`),
              )
            } else if (!validRefs.has(cmd.target)) {
              errors.push(
                makeError(
                  `Release of named resource "${cmd.resourceName}" target "${cmd.target}" does not resolve to a known value property`,
                ),
              )
            }
          }
        }
      }
    }
  }

  return errors
}

/**
 * Validates the parent workflow and all child workflows recursively.
 * Child workflow errors include the workflow name for context.
 */
export function validateWorkflowWithChildren(
  parentNodes: WorkflowNode[],
  parentEdges: Edge[],
  parentSpecId: string,
  allSpecs: Specification[],
  parentWorkflowTrySpecs: TrySpec[] = [],
): ValidationError[] {
  // Validate parent structure
  const errors = validateWorkflow(parentNodes, parentEdges, parentWorkflowTrySpecs)

  // Validate parent references (input sources, output destinations, resources)
  const parentSpec = allSpecs.find((s) => s.id === parentSpecId)
  if (parentSpec) {
    const parentData = parentSpec.data as Record<string, unknown>
    errors.push(...validateReferences(parentNodes, parentData, allSpecs))
  }

  // Recursively validate child workflows
  const validateChildren = (specId: string) => {
    const children = allSpecs.filter((s) => {
      const data = s.data as { parentSpecificationId?: string } | null
      return data?.parentSpecificationId === specId
    })

    for (const child of children) {
      const data = child.data as Record<string, unknown> | null
      const childNodes = (data?.nodes ?? []) as WorkflowNode[]
      const childEdges = (data?.edges ?? []) as Edge[]
      const childWorkflowTrySpecs = (data?.workflowTrySpecifications ?? []) as TrySpec[]

      // Structure validation
      const childErrors = validateWorkflow(childNodes, childEdges, childWorkflowTrySpecs)
      for (const err of childErrors) {
        errors.push({ ...err, workflowName: child.name })
      }

      // Reference validation
      if (data) {
        const refErrors = validateReferences(childNodes, data, allSpecs, child.name)
        errors.push(...refErrors)
      }

      // Recurse into grandchildren
      validateChildren(child.id)
    }
  }

  validateChildren(parentSpecId)
  return errors
}
