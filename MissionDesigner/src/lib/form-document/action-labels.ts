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
import type { FormDocument } from '@mission/form-schema'
import { derivePreviewDecision } from '@/components/form-designer/v2/preview/previewDecision'

/**
 * The editable labels for a step's host-chrome decision buttons — a single Continue, or a
 * Yes/No pair. Labels only; routing values (yesNoYesValue/yesNoNoValue) are edited elsewhere.
 */
export type ActionLabelDraft = { kind: 'continue'; label: string } | { kind: 'yesno'; yes: string; no: string }

/** Seed the draft from a step's current decision config (mirrors the preview decision bar). */
export function deriveActionDraft(
  nodeType: string,
  data: Pick<StepNodeData, 'uiParameters' | 'yesNoYesValue' | 'yesNoNoValue'>,
  document?: FormDocument | null,
): ActionLabelDraft {
  const d = derivePreviewDecision(nodeType, data, document)
  return d.kind === 'yesno' ? { kind: 'yesno', yes: d.yes.label, no: d.no.label } : { kind: 'continue', label: d.label }
}

/**
 * Write the edited labels back into a step's uiParameters. Updates the relevant param
 * (YesNoButtons for a yes/no step, Button otherwise) in place, or appends it if the step
 * has none yet. Pure except for minting an id for a newly-created param. Other params are
 * preserved untouched.
 */
export function applyActionLabels(params: UIParameterSpec[], draft: ActionLabelDraft): UIParameterSpec[] {
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
