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

/** TRY failure modes. Step rows take the first three; workflow-level rows also take the Operator modes. */
export const STEP_TRY_MODES = ['ERROR', 'ABORT', 'TIMEOUT'] as const
export const WORKFLOW_TRY_MODES = [...STEP_TRY_MODES, 'OPERATOR_STOP', 'OPERATOR_ABORT'] as const

export type StepTryMode = (typeof STEP_TRY_MODES)[number]
export type WorkflowTryMode = (typeof WORKFLOW_TRY_MODES)[number]

export const TRY_MODE_LABELS: Record<WorkflowTryMode, string> = {
  ERROR: 'ERROR',
  ABORT: 'ABORT',
  TIMEOUT: 'TIMEOUT',
  OPERATOR_STOP: 'Operator Stop',
  OPERATOR_ABORT: 'Operator Abort',
}

export function isOperatorMode(m: string): m is 'OPERATOR_STOP' | 'OPERATOR_ABORT' {
  return m === 'OPERATOR_STOP' || m === 'OPERATOR_ABORT'
}
