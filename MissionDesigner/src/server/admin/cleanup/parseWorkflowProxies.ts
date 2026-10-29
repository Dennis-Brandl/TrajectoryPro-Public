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

import type { WorkflowProxyNode } from './types'

export function parseWorkflowProxies(ownerSpecId: string, dataJson: string): WorkflowProxyNode[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(dataJson)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object') return []
  const nodes = (parsed as { nodes?: unknown }).nodes
  if (!Array.isArray(nodes)) return []

  const out: WorkflowProxyNode[] = []
  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue
    const node = n as {
      id?: unknown
      type?: unknown
      data?: { subWorkflowMode?: unknown; embeddedWorkflowSpecId?: unknown; referencedStepSpecId?: unknown }
    }
    if (node.type !== 'workflowProxy') continue
    if (typeof node.id !== 'string') continue
    const d = node.data ?? {}
    const mode = d.subWorkflowMode === 'embedded' || d.subWorkflowMode === 'reference' ? d.subWorkflowMode : undefined
    out.push({
      nodeId: node.id,
      ownerSpecId,
      subWorkflowMode: mode,
      embeddedWorkflowSpecId: typeof d.embeddedWorkflowSpecId === 'string' ? d.embeddedWorkflowSpecId : undefined,
      referencedStepSpecId: typeof d.referencedStepSpecId === 'string' ? d.referencedStepSpecId : undefined,
    })
  }
  return out
}
