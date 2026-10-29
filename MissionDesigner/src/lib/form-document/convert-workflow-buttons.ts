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
import { convertButtons, type ConvertButtonsResult, type FormDocument } from '@mission/form-schema'
import { stepKindOfNode } from './step-kind'

export interface WorkflowButtonConversion {
  nodeId: string
  nodeName: string
  result: ConvertButtonsResult
}

/**
 * Plans the workflow-wide "Convert buttons" pass: every User Interaction / Yes-No step that
 * has a form and whose form would change. Pure; nothing is written until the caller applies it.
 */
export function planWorkflowButtonConversion(nodes: Node[], newId: () => string): WorkflowButtonConversion[] {
  const plan: WorkflowButtonConversion[] = []
  for (const node of nodes) {
    if (node.type !== 'userInteractionStep' && node.type !== 'yesNoStep') continue
    const data = (node.data ?? {}) as { label?: string; formDocument?: FormDocument }
    if (!data.formDocument) continue
    const result = convertButtons(data.formDocument, stepKindOfNode(node.type), newId)
    if (!result.changed) continue
    plan.push({ nodeId: node.id, nodeName: data.label || node.id, result })
  }
  return plan
}
