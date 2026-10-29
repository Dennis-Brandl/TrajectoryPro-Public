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
import type { NodeType, StepNodeData } from '@/types/nodes'

/**
 * Default node data for a freshly-created step.
 *
 * A RETURN node carries the default ABANDON command immediately so its canvas label and
 * exported return_config are populated from creation. Without this, a RETURN left at the
 * dropdown's visual default never persists returnConfig (ReturnConfigEditor only writes on a
 * change event), so the label stays blank and the workflow strands at runtime until the user
 * deselects and re-picks the command.
 */
export function defaultStepData(type: NodeType, label: string): StepNodeData {
  return {
    label,
    stepType: type,
    ...(type === 'return' ? { returnConfig: { command: 'ABANDON' as const } } : {}),
    ...(type === 'gateStep' ? { gateCycleSeconds: 5 } : {}),
  } as StepNodeData
}
