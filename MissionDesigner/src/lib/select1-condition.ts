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

import type { Select1OptionSpec, StepNodeData } from '@/types/nodes'

const COMPARISONS = [
  { value: '==', label: '=' },
  { value: '!=', label: '≠' },
  { value: '<', label: '<' },
  { value: '>', label: '>' },
  { value: '<=', label: '≤' },
  { value: '>=', label: '≥' },
  { value: 'Contains', label: '∋' },
  { value: 'Not Contains', label: '∌' },
] as const

export interface Select1OptionDescription {
  kind: 'default' | 'condition' | 'unconfigured' | 'missing'
  text: string
  label: string
}

/** Describes the SELECT 1 option bound to an outgoing handle (option id === edge sourceHandle). */
export function describeSelect1Option(
  nodeData: StepNodeData,
  sourceHandleId: string | null | undefined,
): Select1OptionDescription {
  const options = (nodeData.select1Options || []) as Select1OptionSpec[]
  const opt = options.find((o) => o.id === sourceHandleId)
  if (!opt) return { kind: 'missing', text: '', label: '' }
  if (opt.isDefault) return { kind: 'default', text: opt.label || '[default]', label: opt.label }
  if (opt.value && opt.value.trim() !== '') {
    const inputName = nodeData.select1InputName || '?'
    const comp = COMPARISONS.find((c) => c.value === opt.operator)
    return { kind: 'condition', text: `${inputName} ${comp?.label || opt.operator} ${opt.value}`, label: opt.label }
  }
  return { kind: 'unconfigured', text: opt.label || String(options.indexOf(opt) + 1), label: opt.label }
}
