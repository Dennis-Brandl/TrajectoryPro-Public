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
import { generateOID, WORKER_INTERNAL } from '@/lib/snowflake'
import type { StepNodeData, UIParameterSpec } from '@/types/nodes'
import type { ButtonBarStyle, FormDocument, TypeToken } from '@mission/form-schema'
import { derivePreviewDecision } from '@/components/form-designer/v2/preview/previewDecision'

type BarSize = { size?: TypeToken }

/**
 * The step's buttons as the Buttons panel edits them — a single Continue, or a Yes/No pair — with
 * the fixed button row's text size and color(s). Style keys are only ever set for a fixed step
 * (one with `buttonBar`). Routing values (yesNoYesValue/yesNoNoValue) are edited elsewhere.
 */
export type ActionLabelDraft =
  | ({ kind: 'continue'; label: string; color?: string } & BarSize)
  | ({ kind: 'yesno'; yes: string; no: string; yesColor?: string; noColor?: string } & BarSize)

/** The bar's style keys a draft of this kind owns. */
const STYLE_KEYS = {
  continue: ['size', 'color'],
  yesno: ['size', 'yesColor', 'noColor'],
} as const satisfies Record<ActionLabelDraft['kind'], readonly (keyof ButtonBarStyle)[]>

/** Seed the draft from a step's current decision config (mirrors the preview decision bar). */
export function deriveActionDraft(
  nodeType: string,
  data: Pick<StepNodeData, 'uiParameters' | 'yesNoYesValue' | 'yesNoNoValue' | 'buttonBar'>,
  document?: FormDocument | null,
): ActionLabelDraft {
  // A fixed step's text is its own; leftover form buttons never lend it a label.
  const d = derivePreviewDecision(nodeType, data, data.buttonBar ? null : document)
  const draft: ActionLabelDraft =
    d.kind === 'yesno' ? { kind: 'yesno', yes: d.yes.label, no: d.no.label } : { kind: 'continue', label: d.label }
  const bar = data.buttonBar
  if (!bar) return draft
  const style = draft as Record<string, unknown>
  for (const key of STYLE_KEYS[draft.kind]) if (bar[key] !== undefined) style[key] = bar[key]
  return draft
}

/**
 * Write the draft back to a step: the text into its uiParameters (YesNoButtons for a yes/no step,
 * Button otherwise — updated in place, or appended when the step has none yet; other params are
 * untouched), and, on a fixed step only, the size and color(s) into `buttonBar`. A legacy step
 * (no `buttonBar`) never gains one here. Pure except for minting an id for a new param.
 */
export function applyActionLabels(
  data: Pick<StepNodeData, 'uiParameters' | 'buttonBar'>,
  draft: ActionLabelDraft,
): { uiParameters: UIParameterSpec[]; buttonBar?: ButtonBarStyle } {
  const uiParameters = applyLabels(data.uiParameters ?? [], draft)
  if (!data.buttonBar) return { uiParameters }
  const buttonBar: ButtonBarStyle = { ...data.buttonBar }
  const style = draft as Record<string, unknown>
  for (const key of STYLE_KEYS[draft.kind]) {
    const v = style[key]
    if (v === undefined || v === '') delete buttonBar[key]
    else (buttonBar as Record<string, unknown>)[key] = v
  }
  return { uiParameters, buttonBar }
}

function applyLabels(params: UIParameterSpec[], draft: ActionLabelDraft): UIParameterSpec[] {
  if (draft.kind === 'yesno') {
    if (!params.some((p) => p.type === 'YesNoButtons')) {
      return [...params, { id: generateOID(WORKER_INTERNAL), type: 'YesNoButtons', value: draft.yes, value2: draft.no }]
    }
    return params.map((p) => (p.type === 'YesNoButtons' ? { ...p, value: draft.yes, value2: draft.no } : p))
  }
  if (!params.some((p) => p.type === 'Button')) {
    return [...params, { id: generateOID(WORKER_INTERNAL), type: 'Button', value: draft.label }]
  }
  return params.map((p) => (p.type === 'Button' ? { ...p, value: draft.label } : p))
}

/** The fixed bar's style as the draft has it now (for the canvas strip and Preview, before Save). */
export function barStyleFromDraft(draft: ActionLabelDraft): ButtonBarStyle {
  const out: ButtonBarStyle = {}
  const style = draft as Record<string, unknown>
  for (const key of STYLE_KEYS[draft.kind]) {
    const v = style[key]
    if (typeof v === 'string' && v !== '') (out as Record<string, unknown>)[key] = v
  }
  return out
}
