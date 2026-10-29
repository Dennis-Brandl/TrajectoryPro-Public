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

// "Generate Template" text for the script editor — pure, so it can be tested without CodeMirror.

type Param = { name: string; description?: string }

export function scriptTemplate(opts: {
  inputs: Param[]
  outputs: Param[]
  variant: 'script' | 'gate'
  repeat: boolean
}): string {
  const { inputs, outputs, variant, repeat } = opts
  const lines: string[] = ['// Auto-generated script template', '']
  for (const p of inputs) lines.push(`//INPUT: ${p.name}${p.description ? ` - ${p.description}` : ''}`)

  if (variant === 'gate') {
    if (inputs.length > 0) lines.push('')
    lines.push('// Return TRUE to open the gate (the next step activates).')
    lines.push('// Return FALSE to re-evaluate on the next cycle.')
    lines.push('')
    lines.push('return false;')
    return lines.join('\n')
  }

  if (inputs.length > 0) lines.push('')
  for (const p of outputs) lines.push(`//OUTPUT: output.${p.name}${p.description ? ` - ${p.description}` : ''}`)
  lines.push('')

  if (repeat) {
    lines.push('// Repeat until done: this script runs again every cycle until it returns true.')
    lines.push('// state keeps its values between runs (JSON data, up to 64 KB).')
    lines.push('// Outputs are saved when the step completes: return true, a time limit set to')
    lines.push('// complete, or Force complete / Continue now.')
    lines.push('state.runs = (state.runs || 0) + 1;')
    lines.push('')
    lines.push('return false; // return true when the work is done')
    return lines.join('\n')
  }

  lines.push('return true;')
  return lines.join('\n')
}
