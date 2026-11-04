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

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Paths under src that keep their own colors:
//  - nodes/ and edges/: workflow notation (step-type colors) drawn on the canvas
//  - form-designer/v2/preview/: rendered forms, shown as operators will see them
//  - FormDocumentCanvas.tsx, StructuralDragLayer.tsx: the form canvas and its drag cues
export const EXEMPT = [
  'src/components/nodes/',
  'src/components/edges/',
  'src/components/form-designer/v2/preview/',
  'src/components/form-designer/v2/FormDocumentCanvas.tsx',
  'src/components/form-designer/v2/dnd/StructuralDragLayer.tsx',
]

// A line that really encodes a notation or step-type meaning may opt out with this marker.
const ALLOW_MARKER = '// notation color'
const FORBIDDEN = /\b(slate|gray|zinc)-\d+|\b(text|bg|border|ring|accent|outline)-blue-\d+/

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (p.endsWith('.tsx')) out.push(p)
  }
  return out
}

describe('designer chrome uses shared color tokens', () => {
  it('has no fixed slate, gray, zinc or blue classes outside the exempt paths', () => {
    const root = path.resolve(__dirname, '../..')
    const hits: string[] = []
    for (const file of walk(path.join(root, 'src'))) {
      const rel = path.relative(root, file).split(path.sep).join('/')
      if (EXEMPT.some((e) => rel.startsWith(e))) continue
      if (/\.test\.tsx$/.test(rel) || rel.includes('/__tests__/')) continue
      fs.readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (FORBIDDEN.test(line) && !line.includes(ALLOW_MARKER)) hits.push(`${rel}:${i + 1}: ${line.trim()}`)
        })
    }
    expect(hits).toEqual([])
  })
})
