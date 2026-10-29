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
import { describe, expect, it } from 'vitest'
import { convertFormLayouts } from '../index'
import type { V1FormLayouts } from '../index'

function layoutsWithFooterPair(yesLabel: string, noLabel: string): V1FormLayouts {
  const text = { id: 'el-text', type: 'text', x: 40, y: 40, width: 400, height: 30, content: 'Hello' }
  const yes = { id: 'el-yes', type: 'button', x: 200, y: 900, width: 120, height: 44, label: yesLabel, outputValue: 'true', deletable: false }
  const no = { id: 'el-no', type: 'button', x: 340, y: 900, width: 120, height: 44, label: noLabel, outputValue: 'false', deletable: false }
  const layout = { canvasWidth: 768, canvasHeight: 1024, elements: [text, yes, no] }
  return { phone: layout, tablet: layout, desktop: layout } as unknown as V1FormLayouts
}

describe('droppedYesNoButtons structured labels', () => {
  it('carries the dropped pair labels as yesNoLabels', () => {
    const { document, report } = convertFormLayouts(layoutsWithFooterPair('Proceed', 'Abort'))
    const entry = report.entries.find((e) => e.kind === 'droppedYesNoButtons')
    expect(entry).toBeDefined()
    expect(entry!.yesNoLabels).toEqual({ yes: 'Proceed', no: 'Abort' })
    // Pair is dropped: no footer section materializes
    expect(document.sections.some((s) => s.role === 'footer')).toBe(false)
  })

  it('label-less buttons yield empty strings, not undefined', () => {
    const v1 = layoutsWithFooterPair('x', 'x')
    delete (v1.desktop.elements[1] as unknown as Record<string, unknown>).label
    delete (v1.desktop.elements[2] as unknown as Record<string, unknown>).label
    const { report } = convertFormLayouts(v1)
    const entry = report.entries.find((e) => e.kind === 'droppedYesNoButtons')
    expect(entry!.yesNoLabels).toEqual({ yes: '', no: '' })
  })
})
