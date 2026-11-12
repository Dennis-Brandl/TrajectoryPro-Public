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
import type { Block, ButtonBlock, ButtonBarStyle, FormDocument } from '@mission/form-schema'
import { jobButtons, stripButtonBlocks } from '@mission/form-schema'
import { generateOID, WORKER_INTERNAL } from '@/lib/snowflake'
import type { StepNodeData, UIParameterSpec } from '@/types/nodes'

export interface FixedBarConversion {
  /** Converted copy; the input is never mutated. */
  data: StepNodeData
  /** False when the step is already fixed. */
  changed: boolean
  note: string | null
  routingProblem: string | null
  /** The routed button values still used by outgoing conditions (empty when no routing problem). */
  routingValues: string[]
}

function allButtons(doc: FormDocument | undefined): ButtonBlock[] {
  const out: ButtonBlock[] = []
  for (const s of doc?.sections ?? [])
    for (const r of s.rows) for (const b of r.blocks as Block[]) if (b.type === 'button') out.push(b)
  return out
}

function setParam(params: UIParameterSpec[], type: string, patch: Partial<UIParameterSpec>): UIParameterSpec[] {
  if (params.some((p) => p.type === type))
    return params.map((p) => (p.type === type ? ({ ...p, ...patch } as UIParameterSpec) : p))
  return [...params, { id: generateOID(WORKER_INTERNAL), type, value: '', ...patch } as UIParameterSpec]
}

/**
 * Convert a step to the fixed button row: the step keeps its button text (ui-parameters), takes
 * missing text / color / size from the form's job buttons, then loses every button block.
 */
export function convertToFixedBar(
  nodeType: 'userInteractionStep' | 'yesNoStep',
  data: StepNodeData,
  outgoingConditions: string[],
): FixedBarConversion {
  if (data.buttonBar) {
    return { data, changed: false, note: null, routingProblem: null, routingValues: [] }
  }
  const doc = data.formDocument
  const jobs = doc ? jobButtons(doc) : []
  const removed = allButtons(doc)
  let params: UIParameterSpec[] = [...(data.uiParameters ?? [])]
  const bar: ButtonBarStyle = {}

  if (nodeType === 'yesNoStep') {
    const yes = jobs.find((b) => b.job === 'yes') ?? removed.find((b) => !b.job && b.outputValue === 'true')
    const no = jobs.find((b) => b.job === 'no') ?? removed.find((b) => !b.job && b.outputValue === 'false')
    const cur = params.find((p) => p.type === 'YesNoButtons')
    const yesLabel = cur?.value || yes?.label || ''
    const noLabel = cur?.value2 || no?.label || ''
    if (yesLabel || noLabel || cur) params = setParam(params, 'YesNoButtons', { value: yesLabel, value2: noLabel })
    if (yes?.color) bar.yesColor = yes.color
    if (no?.color) bar.noColor = no.color
    const size = yes?.size ?? no?.size
    if (size) bar.size = size
  } else {
    const cont = jobs.find((b) => b.job === 'continue')
    const cur = params.find((p) => p.type === 'Button')
    const label = cur?.value || cont?.label || ''
    if (label || cur) params = setParam(params, 'Button', { value: label })
    if (cont?.color) bar.color = cont.color
    if (cont?.size) bar.size = cont.size
  }

  const out: StepNodeData = {
    ...data,
    uiParameters: params,
    buttonBar: bar,
    allowBack: false,
    allowStop: false,
  }
  if (doc) out.formDocument = stripButtonBlocks(doc)

  const yesNoValue = (v: string) => nodeType === 'yesNoStep' && (v === 'true' || v === 'false')
  const routedValues = [
    ...new Set(
      removed
        .filter(
          (b) => !b.job && b.outputValue && !yesNoValue(b.outputValue) && outgoingConditions.includes(b.outputValue),
        )
        .map((b) => b.outputValue as string),
    ),
  ]
  const routed = routedValues.length > 0 ? { outputValue: routedValues[0] } : undefined
  return {
    data: out,
    changed: true,
    note:
      removed.length > 0
        ? `Buttons moved to the step's bottom bar: ${removed.length} button(s) removed from the form; custom placement and per-device sizes were dropped.`
        : null,
    routingValues: routedValues,
    routingProblem: routed
      ? `This step routed on which button was pressed ("${routed.outputValue}"). Make it a Yes/No step or add a decision step after it.`
      : null,
  }
}
