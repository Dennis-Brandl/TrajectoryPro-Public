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

import { describe, it, expect, vi } from 'vitest'
import type { jsPDF } from 'jspdf'
import { renderStepHeading } from '../pdf-step-pages'

function stubDoc() {
  const calls: Array<[string, unknown[]]> = []
  const rec =
    (k: string) =>
    (...a: unknown[]) => {
      calls.push([k, a])
    }
  const doc = {
    text: vi.fn(rec('text')),
    line: vi.fn(rec('line')),
    setLineWidth: vi.fn(rec('setLineWidth')),
    setFontSize: vi.fn(rec('setFontSize')),
    setDrawColor: vi.fn(),
    setTextColor: vi.fn(),
    setFont: vi.fn(),
    splitTextToSize: vi.fn((s: string) => [s]),
  }
  return { doc: doc as unknown as jsPDF, calls }
}

describe('renderStepHeading — each step in a workflow PDF starts with a thick rule and a large name', () => {
  it('draws a thick full-width rule, then the step name in a larger font clear of the rule', () => {
    const { doc, calls } = stubDoc()
    const end = renderStepHeading(doc, 'Weigh Material', 100, 300)

    const line = calls.find(([k]) => k === 'line')!
    const lineY = line[1][1] as number
    expect(lineY).toBeGreaterThanOrEqual(100)
    const widths = calls.filter(([k]) => k === 'setLineWidth').map(([, a]) => a[0] as number)
    expect(Math.max(...widths)).toBeGreaterThanOrEqual(2)

    const sizes = calls.filter(([k]) => k === 'setFontSize').map(([, a]) => a[0] as number)
    const nameSize = Math.max(...sizes)
    expect(nameSize).toBeGreaterThanOrEqual(16)

    const name = calls.find(([k, a]) => k === 'text' && (a[0] as string[])[0] === 'Weigh Material')!
    expect((name[1][2] as number) - lineY).toBeGreaterThanOrEqual(nameSize)
    expect(end).toBeGreaterThan(name[1][2] as number)
  })

  it('wraps a long name to the given width', () => {
    const { doc } = stubDoc()
    renderStepHeading(doc, 'A very long step name', 100, 250)
    expect(doc.splitTextToSize).toHaveBeenCalledWith('A very long step name', 250)
  })
})
