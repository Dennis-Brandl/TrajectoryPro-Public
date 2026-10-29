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

import { describe, it, expect } from 'vitest'
import { scriptTemplate } from '../script-template'

const inputs = [{ name: 'level', description: 'tank level %' }]
const outputs = [{ name: 'runs' }]

describe('scriptTemplate', () => {
  it('a one-shot script lists inputs and outputs and ends with return true', () => {
    expect(scriptTemplate({ inputs, outputs, variant: 'script', repeat: false })).toBe(
      [
        '// Auto-generated script template',
        '',
        '//INPUT: level - tank level %',
        '',
        '//OUTPUT: output.runs',
        '',
        'return true;',
      ].join('\n'),
    )
  })
  it('a gate script returns its verdict', () => {
    expect(scriptTemplate({ inputs, outputs: [], variant: 'gate', repeat: false })).toBe(
      [
        '// Auto-generated script template',
        '',
        '//INPUT: level - tank level %',
        '',
        '// Return TRUE to open the gate (the next step activates).',
        '// Return FALSE to re-evaluate on the next cycle.',
        '',
        'return false;',
      ].join('\n'),
    )
  })
  it('a repeating script shows state, output and return true', () => {
    const t = scriptTemplate({ inputs, outputs, variant: 'script', repeat: true })
    expect(t).toContain('//OUTPUT: output.runs')
    expect(t).toContain('state.runs = (state.runs || 0) + 1;')
    expect(t).toContain('return true')
    expect(t.trimEnd().endsWith('return false; // return true when the work is done')).toBe(true)
  })
})
