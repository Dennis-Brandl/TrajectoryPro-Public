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
import { signedLabel, JOB_DEFAULT_LABEL, type FormDocument } from '@mission/form-schema'
import type { ButtonJobs } from '@mission/form-renderer'
import type { StepNodeData } from '@/types/nodes'

export type PreviewDecision =
  | { kind: 'continue'; label: string }
  | { kind: 'yesno'; yes: { label: string; value: string }; no: { label: string; value: string } }

/**
 * Derive the preview chrome decision bar from a UI step's config, mirroring the v1 node
 * renderer (`YesNoStepNode.tsx`): Yes/No labels from the `YesNoButtons` uiParameter
 * (value / value2), routing values from `yesNoYesValue`/`yesNoNoValue` (defaults
 * 'true'/'false'); a userInteraction step shows a single Continue whose label comes from
 * a `Button` uiParameter, else the form's own Continue button, else 'Continue' (D§9.1 —
 * Continue = step Completed state).
 */
export function derivePreviewDecision(
  nodeType: string,
  data: Pick<StepNodeData, 'uiParameters' | 'yesNoYesValue' | 'yesNoNoValue'>,
  document?: FormDocument | null,
): PreviewDecision {
  if (nodeType === 'yesNoStep') {
    const yn = data.uiParameters?.find((p) => p.type === 'YesNoButtons')
    const yesLabel = yn?.value || 'Yes'
    const noLabel = ('value2' in (yn ?? {}) ? (yn as { value2: string }).value2 : undefined) || 'No'
    return {
      kind: 'yesno',
      yes: { label: yesLabel, value: data.yesNoYesValue || 'true' },
      no: { label: noLabel, value: data.yesNoNoValue || 'false' },
    }
  }
  const btn = data.uiParameters?.find((p) => p.type === 'Button')
  return { kind: 'continue', label: btn?.value || formContinueLabel(document) || 'Continue' }
}

/** The label of a Continue button block the form itself holds (forms carried over from the older
 *  format keep one) — Pilot's bottom bar uses it too (mission-control-db inbox continueLabelOf). */
function formContinueLabel(document: FormDocument | null | undefined): string | undefined {
  for (const section of document?.sections ?? []) {
    for (const row of section.rows ?? []) {
      for (const block of row.blocks ?? []) {
        if (block.type === 'button' && block.outputValue === 'continue' && block.label?.trim()) return block.label
      }
    }
  }
  return undefined
}

/** The state of the form's own job buttons in the preview, mirroring Pilot's `buttonJobs`.
 *  Pass the UNDECORATED decision (no "Sign &" prefix); the renderer adds it from `signed`. */
export function buttonJobsFromDecision(
  decision: PreviewDecision,
  gate: { ok: boolean; missing: string[] },
  noGateOk: boolean,
  signed: boolean,
): ButtonJobs {
  const isYesNo = decision.kind === 'yesno'
  return {
    continue: {
      enabled: !isYesNo && gate.ok,
      label: decision.kind === 'continue' ? decision.label : JOB_DEFAULT_LABEL.continue,
    },
    yes: { enabled: isYesNo && gate.ok, label: decision.kind === 'yesno' ? decision.yes.label : JOB_DEFAULT_LABEL.yes },
    no: { enabled: isYesNo && noGateOk, label: decision.kind === 'yesno' ? decision.no.label : JOB_DEFAULT_LABEL.no },
    signed,
  }
}

/** Spec 2026-09-06 D2: when the document holds an e-signature block, the chrome that signs says so.
 *  No stays unsigned. Labels are composed here, never stored. */
export function withSignatureLabels(decision: PreviewDecision, hasSignature: boolean): PreviewDecision {
  if (!hasSignature) return decision
  return decision.kind === 'yesno'
    ? { ...decision, yes: { ...decision.yes, label: signedLabel(decision.yes.label) } }
    : { ...decision, label: signedLabel(decision.label) }
}
