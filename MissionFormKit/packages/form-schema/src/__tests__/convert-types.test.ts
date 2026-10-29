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
import type { V1FormLayouts, V1Element } from '../convert/v1-types'
import type { ConversionEntry, ConversionReport } from '../convert/report'

describe('convert vocabulary', () => {
  it('accepts a minimal v1 layouts object', () => {
    const el: V1Element = { id: 'e1', type: 'text', x: 0, y: 0, width: 100, height: 20, content: 'hi' }
    const v1: V1FormLayouts = {
      phone: { canvasWidth: 360, canvasHeight: 800, elements: [] },
      tablet: { canvasWidth: 1280, canvasHeight: 720, elements: [] },
      desktop: { canvasWidth: 1024, canvasHeight: 768, elements: [el] },
    }
    expect(v1.desktop.elements[0]!.content).toBe('hi')
  })

  it('models a report as a flat list of typed entries', () => {
    const entry: ConversionEntry = { kind: 'fontSizeLost', blockId: 'e1', detail: '18px → lg' }
    const report: ConversionReport = { entries: [entry] }
    expect(report.entries[0]!.kind).toBe('fontSizeLost')
  })
})
