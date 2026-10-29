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
import type { Block, BlockLayout, FormDocument, Row, Section } from '../types'
import type { V1Element, V1FormLayouts } from './v1-types'
import type { ConversionEntry, ConversionReport } from './report'
import { rescaleLegacyDesktop } from './rescale'
import { clusterRows } from './cluster-rows'
import { quantizeSpans } from './spans'
import { mapBlock } from './blocks'
import { classifyFooter, splitTrailingButtonRows } from './footer'

function rowToBlocks(row: V1Element[], entries: ConversionEntry[]): Block[] {
  const spans = quantizeSpans(row, entries)
  return row.map((el, i) => {
    const block = mapBlock(el, entries)
    const layout: BlockLayout = { ...(block.layout ?? {}), span: { base: spans[i]! } }
    return { ...block, layout }
  })
}

function checkPhoneDivergence(phone: V1Element[], baseRows: V1Element[][], entries: ConversionEntry[]): void {
  const baseOrder = new Map(baseRows.flat().map((el, i) => [el.id, i]))
  const phoneSeq = [...phone].sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x)).map((el) => baseOrder.get(el.id)).filter((n): n is number => n !== undefined)
  for (let i = 1; i < phoneSeq.length; i++) {
    if (phoneSeq[i]! < phoneSeq[i - 1]!) {
      entries.push({ kind: 'phoneOrderDivergence', detail: 'v1 phone y-order diverges from the inferred desktop row order; review the converted stacking' })
      return
    }
  }
}

export function convertFormLayouts(v1: V1FormLayouts): { document: FormDocument; report: ConversionReport } {
  const entries: ConversionEntry[] = []

  const els = rescaleLegacyDesktop(v1.desktop.elements, entries)
  const rows = clusterRows(els)
  const { contentRows, trailingButtons } = splitTrailingButtonRows(rows)
  const keptButtons = classifyFooter(trailingButtons, entries)

  const sections: Section[] = []

  const contentSection: Section = {
    id: 'content',
    role: 'content',
    rows: contentRows.map((row, i): Row => ({ id: `content-row-${i}`, blocks: rowToBlocks(row, entries) })),
  }
  sections.push(contentSection)

  if (keptButtons.length > 0) {
    sections.push({ id: 'footer', role: 'footer', rows: [{ id: 'footer-row-0', blocks: rowToBlocks(keptButtons, entries) }] })
  }

  checkPhoneDivergence(v1.phone.elements, rows, entries)

  return { document: { version: 2, sections }, report: { entries } }
}
