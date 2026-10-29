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

import type { MasterWorkflowSpecification, MasterWorkflowStep, MasterEnvironmentSpecification } from './export-types'

type Binding = NonNullable<MasterWorkflowStep['action_property_bindings']>[number]

/**
 * Derive Action-Property bindings for every step of an ASSEMBLED export (root + children,
 * recursively) — GATE spec 2026-08-29 §8.4, generalized by spec 2026-09-04 §5.3 to every
 * step: a GATE's bindings live in `gate_config.action_property_bindings` (re-acquired every
 * cycle by the engine); any other step's live in `step.action_property_bindings` (acquired
 * once at step start). Children resolve against their own env roster first, then the root's.
 * Mutates the spec in place. Returns warnings (rule 4 ambiguity).
 *
 * Precedence per input with value_type 'property':
 *  1. a workflow Value Property of the same group name wins — NOT a binding;
 *  2. the step's OWN environment (an ACTION PROXY's action_proxy_config.environment_oid), then
 *     the immediately preceding ACTION PROXY's environment, when it declares the group;
 *  3. the unique declaring environment;
 *  4. multiple declare + rule 2 inapplicable → first in spec order + a warning.
 */
export function applyActionPropertyBindings(spec: MasterWorkflowSpecification): string[] {
  const warnings: string[] = []
  const rootEnvs = spec.environment_specifications ?? []
  const walk = (wf: MasterWorkflowSpecification): void => {
    const envs = wf === spec ? rootEnvs : [...(wf.environment_specifications ?? []), ...rootEnvs]
    for (const s of wf.steps) deriveForStep(wf, spec, s, envs, warnings)
    for (const child of wf.children ?? []) walk(child)
  }
  walk(spec)
  return warnings
}

/** @deprecated GATE-era name — the same function. */
export const applyGateBindings = applyActionPropertyBindings

function deriveForStep(
  wf: MasterWorkflowSpecification,
  root: MasterWorkflowSpecification,
  step: MasterWorkflowStep,
  envs: MasterEnvironmentSpecification[],
  warnings: string[],
): void {
  const isGate = step.step_type === 'GATE'
  // Rule 1's scope matches the picker's (spec 2026-09-04 D5): the workflow's own Value
  // Properties, the root's (a child inherits the root's store at runtime), and every in-scope
  // environment's — a name declared as a Value Property anywhere in scope is never bound.
  const valueProps = new Set<string>([
    ...(wf.value_property_specifications ?? []).map((p) => p.name),
    ...(root.value_property_specifications ?? []).map((p) => p.name),
    ...envs.flatMap((e) => (e.value_property_specifications ?? []).map((p) => p.name)),
  ])
  const incoming = wf.connections.find((c) => c.to_step_id === step.oid)
  const pred = incoming ? wf.steps.find((s) => s.oid === incoming.from_step_id) : undefined
  const predEnvOid = pred?.step_type === 'ACTION PROXY' ? pred.action_proxy_config?.environment_oid : undefined
  const ownEnvOid = step.step_type === 'ACTION PROXY' ? step.action_proxy_config?.environment_oid : undefined
  const label = isGate ? 'Gate' : 'Step'

  const bindings: Binding[] = []
  for (const input of step.input_parameter_specifications ?? []) {
    if (input.value_type !== 'property' || !input.default_value) continue
    const group = input.default_value.split('.')[0]
    if (!group || valueProps.has(group)) continue // rule 1
    const declaring = envs.filter((e) => (e.action_property_specifications ?? []).some((p) => p.name === group))
    if (declaring.length === 0) continue // not an Action Property — plain store lookup at runtime
    let env = declaring[0]
    if (declaring.length > 1) {
      const preferred =
        (ownEnvOid ? declaring.find((e) => e.oid === ownEnvOid) : undefined) ??
        (predEnvOid ? declaring.find((e) => e.oid === predEnvOid) : undefined)
      if (preferred)
        env = preferred // rule 2
      else
        warnings.push(
          `${label} "${step.local_id}" input "${input.id}": property "${group}" is declared by ${declaring.length} environments — bound to "${declaring[0].local_id}" (first in spec order)`,
        )
    }
    bindings.push({
      parameter_id: input.id,
      environment_oid: env.oid,
      environment_name: env.local_id,
      property: input.default_value,
    })
  }
  if (isGate) {
    // Spec 2026-10-13 §3.4: a pure timer gate evaluates no condition — it emits no bindings.
    if (step.gate_config?.mode === 'timer') {
      if (step.gate_config.action_property_bindings) delete step.gate_config.action_property_bindings
    } else if (bindings.length > 0)
      step.gate_config = { ...(step.gate_config ?? {}), action_property_bindings: bindings }
    else if (step.gate_config?.action_property_bindings) delete step.gate_config.action_property_bindings
  } else if (bindings.length > 0) {
    step.action_property_bindings = bindings
  } else {
    delete step.action_property_bindings
  }
}
