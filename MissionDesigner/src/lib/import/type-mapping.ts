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

import type { StepType } from '@/lib/packageFormat/export-types'
import type { NodeType } from '@/types/nodes'

// Step type strings that older package versions emitted. Newer exports use
// 'ACTION PROXY' alone, but importing legacy ZIPs must still resolve these.
type LegacyStepType = 'WAIT ACTION PROXY' | 'NOWAIT ACTION PROXY' | 'MATH'

/**
 * Maps Trajectory step types to internal node types.
 */
export const STEP_TYPE_TO_NODE_TYPE: Record<StepType | LegacyStepType, NodeType> = {
  START: 'start',
  END: 'end',
  'ACTION PROXY': 'actionProxyWait',
  'WAIT ACTION PROXY': 'actionProxyWait',
  'NOWAIT ACTION PROXY': 'actionProxyWait',
  'WORKFLOW PROXY': 'workflowProxy',
  'SELECT 1': 'select1',
  'WAIT ANY': 'waitAny',
  PARALLEL: 'parallel',
  'WAIT ALL': 'waitAll',
  MATH: 'actionProxyWait', // Future: map to dedicated type when implemented
  SCRIPT: 'scriptStep',
  GATE: 'gateStep',
  YES_NO: 'yesNoStep',
  USER_INTERACTION: 'userInteractionStep',
  CATCH: 'catch',
  RETURN: 'return',
}
