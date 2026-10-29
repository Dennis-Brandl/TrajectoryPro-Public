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

import type { ActionDetail } from '@/lib/types'

export function generateTemplate(
  actionName: string,
  state: string,
  action: ActionDetail | undefined
): string {
  const lines: string[] = [
    'def execute(inputs, outputs, props, action_props):',
    '    """',
    `    State handler for ${actionName} - ${state}`,
    '',
    '    Return True to advance to next state.',
    '    Return False to trigger HOLD.',
    '    """',
  ]

  const inputSpecs = action?.input_parameter_specifications ?? []
  if (inputSpecs.length > 0) {
    lines.push('')
    lines.push('    # -- Input Parameters ------------------------------------')
    for (const p of inputSpecs) {
      const defaultPart = p.default_value ? `  default: "${p.default_value}"` : ''
      const descPart = p.description ? `  - ${p.description}` : ''
      lines.push(`    # inputs['${p.id}']    (${p.value_type})${defaultPart}${descPart}`)
    }
  }

  const outputSpecs = action?.output_parameter_specifications ?? []
  if (outputSpecs.length > 0) {
    lines.push('')
    lines.push('    # -- Output Parameters -----------------------------------')
    for (const p of outputSpecs) {
      const descPart = p.description ? `  - ${p.description}` : ''
      lines.push(`    # outputs['${p.id}']    (${p.value_type})${descPart}`)
    }
  }

  const propSpecs = action?.property_specifications ?? []
  if (propSpecs.length > 0) {
    lines.push('')
    lines.push('    # -- Action Properties -----------------------------------')
    for (const group of propSpecs) {
      for (const entry of group.entries) {
        lines.push(`    # action_props['${group.name}']['${entry.name}']  = "${entry.value}"`)
      }
    }
  }

  lines.push('')
  lines.push('    return True')
  lines.push('')

  return lines.join('\n')
}
