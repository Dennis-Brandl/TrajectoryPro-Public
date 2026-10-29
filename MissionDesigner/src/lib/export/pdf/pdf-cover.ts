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

/**
 * Cover page and Table of Contents renderer for the Workflow PDF.
 *
 * Renders the branded cover header followed by four property tables
 * (Input Parameters, Output Parameters, Value Properties, Resources),
 * then provides a TOC renderer that fills a pre-reserved page using
 * doc.setPage() after all content has been added.
 *
 * WPDF-01, WPDF-02 — Phase 29: Workflow Cover, Children & Assembly
 */

import type jsPDF from 'jspdf'
import { renderCoverHeader, renderSectionHeader, addPortraitPage, ensureSpace } from './pdf-export'
import {
  renderLabeledTable,
  buildCoverInputParamsTable,
  buildCoverOutputParamsTable,
  buildCoverValuePropsTable,
  buildCoverResourcesTable,
} from './pdf-tables'
import { PDF_FONTS, PDF_SPACING, PDF_COLORS, PDF_PAGE, type WorkflowPDFOptions } from './pdf-types'

// ---------------------------------------------------------------------------
// TOC entry type
// ---------------------------------------------------------------------------

/** A single entry in the Table of Contents */
export interface TOCEntry {
  /** Display label for this entry */
  label: string
  /** Page number this entry refers to */
  pageNum: number
  /** Indentation level: 0 = top-level, 1 = child section */
  indent?: number
}

// ---------------------------------------------------------------------------
// Cover section renderer
// ---------------------------------------------------------------------------

/**
 * Renders the full cover page section: branded header + four property tables.
 * Renders onto the currently active page (page 1) — does NOT add a new page.
 *
 * Property tables use the 3-column cover format (Name, Type, Description)
 * and show "None" when empty (showNoneIfEmpty: true).
 *
 * @param doc - jsPDF document
 * @param options - Workflow PDF options
 * @returns Y position after the last rendered element
 */
export function renderCoverSection(doc: jsPDF, options: WorkflowPDFOptions): number {
  let y = renderCoverHeader(doc, options)

  y = renderLabeledTable(doc, 'Input Parameters', buildCoverInputParamsTable(options.inputParameters), y, {
    showNoneIfEmpty: true,
  })
  y = renderLabeledTable(doc, 'Output Parameters', buildCoverOutputParamsTable(options.outputParameters), y, {
    showNoneIfEmpty: true,
  })
  y = renderLabeledTable(doc, 'Value Properties', buildCoverValuePropsTable(options.valueProperties), y, {
    showNoneIfEmpty: true,
  })
  y = renderLabeledTable(doc, 'Resources', buildCoverResourcesTable(options.resources), y, {
    showNoneIfEmpty: true,
  })

  return y
}

// ---------------------------------------------------------------------------
// Table of Contents renderer
// ---------------------------------------------------------------------------

/**
 * Fills in a pre-reserved TOC page with formatted entries and leader dots.
 *
 * This is called AFTER all content pages have been rendered. It uses
 * doc.setPage(tocPageNum) to navigate to the reserved page — it does NOT
 * add a new page.
 *
 * @param doc - jsPDF document
 * @param tocPageNum - Pre-reserved page number for the TOC
 * @param entries - TOC entries to render (label + page number + optional indent)
 */
export function renderTableOfContents(doc: jsPDF, tocPageNum: number, entries: TOCEntry[]): void {
  doc.setPage(tocPageNum)

  const margin = PDF_SPACING.PAGE_MARGIN
  const rightEdge = PDF_PAGE.LETTER_WIDTH - PDF_SPACING.PAGE_MARGIN
  const lineStep = PDF_FONTS.BODY * PDF_SPACING.LINE_HEIGHT + 4

  let y: number = margin
  y = renderSectionHeader(doc, 'Table of Contents', y)

  for (const entry of entries) {
    // Ensure there is space — overflow to a new page if needed
    y = ensureSpace(doc, y, lineStep + 4)

    const indentPt = entry.indent === 1 ? 20 : 0
    const labelX = margin + indentPt

    // Label (left-aligned)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(PDF_FONTS.BODY)
    doc.setTextColor(PDF_COLORS.BLACK)
    doc.text(entry.label, labelX, y)

    // Page number (right-aligned)
    const pageLabel = String(entry.pageNum)
    doc.text(pageLabel, rightEdge, y, { align: 'right' })

    // Measure positions for leader line
    const labelEndX = labelX + doc.getTextWidth(entry.label) + 4
    const pageNumStartX = rightEdge - doc.getTextWidth(pageLabel) - 4

    // Dotted leader line between label end and page number
    if (pageNumStartX > labelEndX + 6) {
      if (typeof (doc as unknown as Record<string, unknown>).setLineDashPattern === 'function') {
        ;(doc as unknown as { setLineDashPattern: (dash: number[], phase: number) => void }).setLineDashPattern(
          [1, 2],
          0,
        )
        doc.setDrawColor(PDF_COLORS.GRAY_MID)
        doc.setLineWidth(0.5)
        doc.line(labelEndX, y - PDF_FONTS.BODY * 0.25, pageNumStartX, y - PDF_FONTS.BODY * 0.25)
        ;(doc as unknown as { setLineDashPattern: (dash: number[], phase: number) => void }).setLineDashPattern([], 0)
      } else {
        // Fallback: render dots as text
        const dotSpacing = 4
        const dots: number[] = []
        for (let x = labelEndX; x < pageNumStartX - 2; x += dotSpacing) {
          dots.push(x)
        }
        doc.setTextColor(PDF_COLORS.GRAY_MID)
        doc.setFontSize(PDF_FONTS.BODY)
        for (const dx of dots) {
          doc.text('.', dx, y)
        }
        doc.setTextColor(PDF_COLORS.BLACK)
      }
    }

    y += lineStep

    // If ensureSpace added a new page, re-render section header is not needed —
    // the new page is blank and we continue appending entries
    if (y > PDF_PAGE.LETTER_HEIGHT - PDF_SPACING.PAGE_MARGIN - 30) {
      addPortraitPage(doc)
      y = PDF_SPACING.PAGE_MARGIN
    }
  }
}
