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

import type {
  MasterWorkflowSpecification,
  MasterWorkflowStep,
  StepType,
  WorkflowConnection,
} from '@/lib/packageFormat/export-types'
import type {
  B2mmlBatchParameter,
  B2mmlFormula,
  B2mmlHeader,
  B2mmlLink,
  B2mmlLinkType,
  B2mmlMasterRecipe,
  B2mmlRecipeElement,
  B2mmlRecipeElementType,
  B2mmlStep,
  B2mmlTransition,
} from './batchml-types'

/** Node types that carry no ISA-88 procedural meaning; omitted from the PFC. */
const EXCEPTION_STEP_TYPES = new Set<StepType>(['CATCH', 'RETURN'])

/**
 * Node types that ARE an ISA-88 procedural element, but not a Step/Phase — a GATE is
 * the transition itself (spec 2026-08-29 §8.4), so it never gets its own Step/RecipeElement
 * entry. Distinct from EXCEPTION_STEP_TYPES: exception nodes are dropped along with their
 * connections, while a gate's connections are spliced into the surrounding transition by
 * buildProcedureFlow BEFORE this filter is applied to the Step/RecipeElement lists.
 */
const TRANSITION_STEP_TYPES = new Set<StepType>(['GATE'])

export function stepTypeToRecipeElementType(stepType: StepType): B2mmlRecipeElementType {
  switch (stepType) {
    case 'START':
      return 'Begin'
    case 'END':
      return 'End'
    case 'ACTION PROXY':
    case 'SCRIPT':
    case 'USER_INTERACTION':
    case 'YES_NO':
      return 'Phase'
    case 'WORKFLOW PROXY':
      return 'Operation'
    case 'GATE':
      // Defensive only — gates are spliced out as Transitions before reaching this mapping.
      return 'Other'
    default:
      // SELECT 1, PARALLEL, WAIT ALL, WAIT ANY — control/routing steps
      return 'Other'
  }
}

/** The subset of steps that participate in the PFC as Step/RecipeElement (exception and
 *  transition nodes removed). */
export function pfcSteps(steps: MasterWorkflowStep[]): MasterWorkflowStep[] {
  return steps.filter((s) => !EXCEPTION_STEP_TYPES.has(s.step_type) && !TRANSITION_STEP_TYPES.has(s.step_type))
}

function toStep(s: MasterWorkflowStep): B2mmlStep {
  return {
    id: s.oid,
    recipeElementId: s.oid,
    recipeElementVersion: s.version,
    description: [s.local_id],
  }
}

function toRecipeElement(s: MasterWorkflowStep): B2mmlRecipeElement {
  const el: B2mmlRecipeElement = {
    id: s.oid,
    version: s.version,
    description: [s.local_id],
    recipeElementType: stepTypeToRecipeElementType(s.step_type),
  }
  // Environment → equipment hook for ACTION PROXY phases (design §6.4).
  if (s.step_type === 'ACTION PROXY' && s.action_proxy_config?.environment_oid) {
    el.equipmentRequirement = [
      { id: s.action_proxy_config.environment_oid, description: 'Bound environment (Trajectory)' },
    ]
  }
  return el
}

/** Divergence/convergence link typing from the source and target node kinds. */
export function linkTypeFor(
  sourceType: StepType | undefined,
  targetType: StepType | undefined,
): { from: B2mmlLinkType; to: B2mmlLinkType } {
  const from: B2mmlLinkType =
    sourceType === 'PARALLEL'
      ? 'ParallelDivergent'
      : sourceType === 'SELECT 1' || sourceType === 'YES_NO'
        ? 'SerialDivergent'
        : 'ControlLink'
  const to: B2mmlLinkType =
    targetType === 'WAIT ALL' ? 'ParallelConvergent' : targetType === 'WAIT ANY' ? 'SerialConvergent' : 'ControlLink'
  return { from, to }
}

/** Human/machine condition text for the transition guarding this connection. */
function conditionFor(
  conn: WorkflowConnection,
  source: MasterWorkflowStep | undefined,
): { condition: string; annotation?: string } {
  if (source?.step_type === 'YES_NO') {
    const yes = source.yes_no_config?.yes_value ?? 'true'
    const no = source.yes_no_config?.no_value ?? 'false'
    const val = conn.source_handle_id === 'no' ? no : yes
    return { condition: `result == ${JSON.stringify(val)}`, annotation: conn.source_handle_id ?? undefined }
  }
  if (source?.step_type === 'SELECT 1' && conn.source_handle_id) {
    const opt = source.select1_config?.options?.find((o) => o.id === conn.source_handle_id)
    if (opt) {
      if (opt.is_default) return { condition: 'ELSE', annotation: opt.label }
      const input = source.select1_config?.input_name ?? 'input'
      return { condition: `${input} ${opt.operator} ${JSON.stringify(opt.value)}`, annotation: opt.label }
    }
  }
  if (conn.condition) return { condition: conn.condition }
  return { condition: 'TRUE' }
}

function buildProcedureFlow(
  spec: MasterWorkflowSpecification,
  keptStepIds: Set<string>,
  stepByOid: Map<string, MasterWorkflowStep>,
): { transition: B2mmlTransition[]; link: B2mmlLink[] } {
  const transition: B2mmlTransition[] = []
  const link: B2mmlLink[] = []
  let n = 0

  // GATE splice (spec 2026-08-29 §8.4, generalized post-review to a RUN of gates): a GATE
  // is ISA-88's transition, so P→gate→S collapses to P→Transition(condition = gate
  // script)→S; the gate itself is already omitted from the Step/RecipeElement list by
  // pfcSteps (TRANSITION_STEP_TYPES), and is therefore absent from keptStepIds — the raw
  // P→gate / gate→S connections would be silently dropped by the main loop's kept-node
  // check below. GATE is 1-in/1-out but carries no neighbor-type restriction, so gates can
  // legally chain (P→G1→G2→S): this pre-pass walks each such run to its first non-gate
  // step and collapses the WHOLE run into one transition, or the chain silently vanishes
  // from the exported PFC (each gate's pairwise neighbor is another gate, never a kept
  // step). Reads spec.connections/steps UNFILTERED, before pfcSteps' removal takes effect.
  const gateByOid = new Map(spec.steps.filter((s) => s.step_type === 'GATE').map((s) => [s.oid, s]))
  const skip = new Set<string>()
  let gn = 0
  for (const entry of spec.connections) {
    // Only start a walk from a kept step entering a gate — the run's unique entry point
    // (a gate has exactly one incoming connection, so each run is discovered exactly once).
    if (!keptStepIds.has(entry.from_step_id) || !gateByOid.has(entry.to_step_id)) continue

    const run: MasterWorkflowStep[] = []
    const runConns: WorkflowConnection[] = [entry]
    const visited = new Set<string>()
    let cursor = entry.to_step_id
    let aborted = false
    while (gateByOid.has(cursor)) {
      if (visited.has(cursor)) {
        aborted = true // cycle of gates — validator-forbidden; bail rather than loop forever
        break
      }
      visited.add(cursor)
      run.push(gateByOid.get(cursor)!)
      const outConn = spec.connections.find((c) => c.from_step_id === cursor)
      if (!outConn) {
        aborted = true // dead end — validator-forbidden (GATE requires exactly 1 outgoing)
        break
      }
      runConns.push(outConn)
      cursor = outConn.to_step_id
    }
    if (aborted) continue // emit nothing for this run
    const terminalOid = cursor

    for (const c of runConns) skip.add(`${c.from_step_id}→${c.to_step_id}`)
    if (!keptStepIds.has(terminalOid)) continue

    const tid = `${spec.oid}:g${gn++}`
    const source = stepByOid.get(entry.from_step_id)
    const target = stepByOid.get(terminalOid)
    // GATE follow-up item 4 (2026-09-04): the run's ENTRY connection carries a branch condition
    // of its own when it leaves a SELECT 1 / YES_NO step — conditionFor's convention for every
    // ordinary connection in the loop below. The collapsed Transition keeps it, ANDed ahead of
    // the gate scripts; an unconditioned entry (TRUE) leaves the shape exactly as before.
    const entryCond = conditionFor(entry, source)
    // Spec 2026-10-13 §4.4: a timer is its own term; condition-with-timeout ORs the two.
    const gateTerms = run.map((g) => {
      const condition = g.gate_config?.source ?? 'TRUE'
      const delay = g.gate_config?.delay_seconds
      if (g.gate_config?.mode === 'timer') return `Timer(${delay} s)`
      if (g.gate_config?.mode === 'condition_or_timer') return `(${condition}) OR Timer(${delay} s)`
      return condition
    })
    const terms = entryCond.condition === 'TRUE' ? gateTerms : [entryCond.condition, ...gateTerms]
    const condition = terms.length === 1 ? terms[0] : terms.map((t) => `(${t})`).join(' AND ')
    const conditionAnnotation = [entryCond.annotation, ...run.map((g) => g.local_id)].filter(Boolean).join(' + ')
    transition.push({ id: tid, condition, conditionAnnotation })
    const lt = linkTypeFor(source?.step_type, target?.step_type)
    link.push({
      id: `${tid}:in`,
      fromId: [{ value: entry.from_step_id, type: 'Step', idScope: 'Internal' }],
      toId: [{ value: tid, type: 'Transition', idScope: 'Internal' }],
      linkType: lt.from,
      depiction: 'None',
    })
    link.push({
      id: `${tid}:out`,
      fromId: [{ value: tid, type: 'Transition', idScope: 'Internal' }],
      toId: [{ value: terminalOid, type: 'Step', idScope: 'Internal' }],
      linkType: lt.to,
      depiction: 'None',
    })
  }

  for (const conn of spec.connections) {
    // Skip connections into/out of omitted (exception) nodes, or already spliced above.
    if (!keptStepIds.has(conn.from_step_id) || !keptStepIds.has(conn.to_step_id)) continue
    if (skip.has(`${conn.from_step_id}→${conn.to_step_id}`)) continue
    const tid = `${spec.oid}:t${n++}`
    const source = stepByOid.get(conn.from_step_id)
    const target = stepByOid.get(conn.to_step_id)
    const { condition, annotation } = conditionFor(conn, source)
    transition.push({ id: tid, condition, conditionAnnotation: annotation })
    const lt = linkTypeFor(source?.step_type, target?.step_type)
    link.push({
      id: `${tid}:in`,
      fromId: [{ value: conn.from_step_id, type: 'Step', idScope: 'Internal' }],
      toId: [{ value: tid, type: 'Transition', idScope: 'Internal' }],
      linkType: lt.from,
      depiction: 'None',
    })
    link.push({
      id: `${tid}:out`,
      fromId: [{ value: tid, type: 'Transition', idScope: 'Internal' }],
      toId: [{ value: conn.to_step_id, type: 'Step', idScope: 'Internal' }],
      linkType: lt.to,
      depiction: 'None',
    })
  }
  return { transition, link }
}

function paramValue(defaultValue: string | undefined, jsonSchema: string | undefined): B2mmlBatchParameter['value'] {
  let dataType = 'string'
  try {
    if (jsonSchema) {
      const t = (JSON.parse(jsonSchema) as { type?: string }).type
      if (t === 'number' || t === 'integer') dataType = 'real'
      else if (t === 'boolean') dataType = 'boolean'
    }
  } catch {
    /* untyped literal — leave as string */
  }
  return [{ valueString: defaultValue ?? '', dataType, unitOfMeasure: 'none', dataInterpretation: 'Nominal' }]
}

function buildFormula(spec: MasterWorkflowSpecification): B2mmlFormula | undefined {
  const parameter: B2mmlBatchParameter[] = []
  for (const p of spec.starting_parameter_specifications ?? []) {
    parameter.push({
      id: p.id,
      description: p.description,
      parameterType: 'ProcessInput',
      value: paramValue(p.default_value, p.json_schema),
    })
  }
  for (const p of spec.output_parameter_specifications ?? []) {
    parameter.push({ id: p.id, description: p.description, parameterType: 'ProcessOutput' })
  }
  for (const v of spec.value_property_specifications ?? []) {
    parameter.push({
      id: v.name,
      parameterType: 'ProcessParameter',
      value: paramValue(v.entries?.[0]?.value, undefined),
    })
  }
  return parameter.length > 0 ? { parameter } : undefined
}

// B2MML Status enum is a batch-status vocabulary; map Trajectory lifecycle onto
// the nearest documented value, defaulting to 'Idle' for design-time recipes.
function mapStatus(state: string | undefined): string {
  switch (state) {
    case 'Effective':
    case 'Approved':
      return 'Complete'
    default:
      return 'Idle'
  }
}

function buildHeader(spec: MasterWorkflowSpecification): B2mmlHeader {
  return {
    productId: spec.oid,
    productName: spec.local_id,
    status: mapStatus(spec.state),
  }
}

/**
 * Build a B2MML MasterRecipe from a canonical workflow spec. The PFC skeleton is
 * a standards-shaped projection; the exact truth is carried by the base64
 * canonical-spec payload attached at export time (see canonical-payload.ts).
 */
export function buildMasterRecipe(spec: MasterWorkflowSpecification): B2mmlMasterRecipe {
  const steps = pfcSteps(spec.steps)
  const keptStepIds = new Set(steps.map((s) => s.oid))
  const stepByOid = new Map(spec.steps.map((s) => [s.oid, s]))
  const flow = buildProcedureFlow(spec, keptStepIds, stepByOid)

  return {
    id: spec.oid,
    version: spec.version,
    versionDate: spec.last_modified_date,
    description: [spec.local_id],
    header: buildHeader(spec),
    formula: buildFormula(spec),
    procedureLogic: {
      step: steps.map(toStep),
      transition: flow.transition,
      link: flow.link,
    },
    recipeElement: steps.map(toRecipeElement),
  }
}
