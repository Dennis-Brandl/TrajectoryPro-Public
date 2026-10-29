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
import type jsPDF from 'jspdf'
import { renderCoverHeader, renderLibraryCoverHeader } from '../pdf-export'
import type { WorkflowPDFOptions } from '../pdf-types'

/**
 * The branding line is the first string drawn on a cover page. It read
 * 'TRAJECTORY PRO STUDIO' until rebrand pass 2d (2026-09-12) — a wave-1 miss that
 * survived four sweeps because it is all-caps inside a jsPDF call with no test over
 * it. These two assertions exist so it cannot silently rot again.
 */
function stubDoc() {
  const text = vi.fn()
  const doc = {
    text,
    setFontSize: vi.fn(),
    setTextColor: vi.fn(),
    setFont: vi.fn(),
    splitTextToSize: vi.fn((s: string) => [s]),
  }
  return { doc: doc as unknown as jsPDF, text }
}

describe('cover-page branding', () => {
  it('renderCoverHeader draws MISSION DESIGNER as the first line', () => {
    const { doc, text } = stubDoc()
    const options = {
      name: 'Bake Bread',
      version: '1.0.0',
      oid: 'wf-1',
      nodes: [],
      edges: [],
    } as unknown as WorkflowPDFOptions

    renderCoverHeader(doc, options)

    expect(text.mock.calls[0]?.[0]).toBe('MISSION DESIGNER')
  })

  it('renderLibraryCoverHeader draws MISSION DESIGNER as the first line', () => {
    const { doc, text } = stubDoc()

    renderLibraryCoverHeader(doc, { name: 'Recipes', subtitle: 'Action Library' })

    expect(text.mock.calls[0]?.[0]).toBe('MISSION DESIGNER')
  })
})
