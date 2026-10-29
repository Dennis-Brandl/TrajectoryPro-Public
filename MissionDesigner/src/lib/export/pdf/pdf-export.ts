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

import jsPDF from 'jspdf'
import { PDF_COLORS, PDF_FONTS, PDF_PAGE, PDF_SPACING } from './pdf-types'
import type { WorkflowPDFOptions } from './pdf-types'

// ---------------------------------------------------------------------------
// Document creation
// ---------------------------------------------------------------------------

/**
 * Creates a new jsPDF document in portrait letter format.
 */
export function createPDFDocument(): jsPDF {
  return new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' })
}

// ---------------------------------------------------------------------------
// Page management
// ---------------------------------------------------------------------------

/**
 * Adds a new portrait page using explicit [width, height] array format.
 * MUST use array format (not string 'letter') to avoid known jsPDF blank-page bug.
 *
 * @returns The top margin Y position to start rendering on the new page
 */
export function addPortraitPage(doc: jsPDF): number {
  doc.addPage([PDF_PAGE.LETTER_WIDTH, PDF_PAGE.LETTER_HEIGHT], 'portrait')
  return PDF_SPACING.PAGE_MARGIN
}

/**
 * Ensures there is enough vertical space remaining on the current page.
 * Adds a new page if the needed space does not fit.
 *
 * @param doc - jsPDF document
 * @param currentY - Current Y position
 * @param needed - Required vertical space in points
 * @returns New Y position (either unchanged or top margin of new page)
 */
export function ensureSpace(doc: jsPDF, currentY: number, needed: number): number {
  const pageHeight = PDF_PAGE.LETTER_HEIGHT
  const bottomLimit = pageHeight - PDF_SPACING.PAGE_MARGIN - 30
  if (currentY + needed > bottomLimit) {
    return addPortraitPage(doc)
  }
  return currentY
}

// ---------------------------------------------------------------------------
// Header rendering
// ---------------------------------------------------------------------------

/**
 * Renders the cover page header (branding, title, meta, subtitle, description).
 * Renders onto whichever page is currently active (page 1 on first call).
 *
 * @param doc - jsPDF document
 * @param options - Workflow PDF options
 * @returns Y position after the header block
 */
export function renderCoverHeader(doc: jsPDF, options: WorkflowPDFOptions): number {
  const margin = PDF_SPACING.PAGE_MARGIN
  const pageWidth = PDF_PAGE.portraitWidth
  let y = margin

  // Branding line
  doc.setFontSize(PDF_FONTS.META)
  doc.setTextColor(PDF_COLORS.GRAY_DARK)
  doc.setFont('helvetica', 'normal')
  doc.text('MISSION DESIGNER', margin, y)
  y += PDF_FONTS.META * PDF_SPACING.LINE_HEIGHT + 4

  // Workflow name
  doc.setFontSize(PDF_FONTS.TITLE)
  doc.setTextColor(PDF_COLORS.BLACK)
  doc.setFont('helvetica', 'bold')
  doc.text(options.name, margin, y)
  y += PDF_FONTS.TITLE * PDF_SPACING.LINE_HEIGHT + 4

  // Meta line: "Version X | date | OID: xxx"
  const datePart = options.lastModifiedDate ?? ''
  const metaParts = [`Version ${options.version}`]
  if (datePart) metaParts.push(datePart)
  metaParts.push(`OID: ${options.oid}`)
  const metaLine = metaParts.join(' | ')

  doc.setFontSize(PDF_FONTS.META)
  doc.setTextColor(PDF_COLORS.GRAY_DARK)
  doc.setFont('helvetica', 'normal')
  doc.text(metaLine, margin, y)
  y += PDF_FONTS.META * PDF_SPACING.LINE_HEIGHT + 2

  // Subtitle
  doc.setFontSize(PDF_FONTS.META)
  doc.setTextColor(PDF_COLORS.GRAY_DARK)
  doc.setFont('helvetica', 'normal')
  doc.text('Workflow Specification', margin, y)
  y += PDF_FONTS.META * PDF_SPACING.LINE_HEIGHT + 6

  // Description (word-wrapped)
  if (options.description) {
    doc.setFontSize(PDF_FONTS.BODY)
    doc.setTextColor(PDF_COLORS.BLACK)
    doc.setFont('helvetica', 'normal')
    const lines = doc.splitTextToSize(options.description, pageWidth)
    doc.text(lines, margin, y)
    y += lines.length * PDF_FONTS.BODY * PDF_SPACING.LINE_HEIGHT + 6
  }

  return y
}

// ---------------------------------------------------------------------------
// Library cover options interface
// ---------------------------------------------------------------------------

/**
 * Options for rendering a library cover header.
 * Libraries use a simpler header than workflows (no version/OID).
 */
export interface LibraryCoverOptions {
  /** Library name */
  name: string
  /** Entity type subtitle (e.g. "Action Library", "Environment Library") */
  subtitle: string
  /** Optional description */
  description?: string
  /** Optional date string */
  date?: string
  /** Name font size; defaults to PDF_FONTS.LIBRARY_TITLE */
  titleSize?: number
}

/**
 * Renders a library cover page header (branding, name, date, subtitle, description).
 * Identical to renderCoverHeader but accepts LibraryCoverOptions instead of
 * WorkflowPDFOptions, and uses the dynamic subtitle instead of hardcoded text.
 *
 * @param doc - jsPDF document
 * @param options - Library cover options
 * @returns Y position after the header block
 */
export function renderLibraryCoverHeader(doc: jsPDF, options: LibraryCoverOptions): number {
  const margin = PDF_SPACING.PAGE_MARGIN
  const pageWidth = PDF_PAGE.portraitWidth
  let y = margin

  // Branding line
  doc.setFontSize(PDF_FONTS.META)
  doc.setTextColor(PDF_COLORS.GRAY_DARK)
  doc.setFont('helvetica', 'normal')
  doc.text('MISSION DESIGNER', margin, y)
  y += PDF_FONTS.META * PDF_SPACING.LINE_HEIGHT + 4

  // Library name — the branding line sits above, so drop a full font height to clear it
  const titleSize = options.titleSize ?? PDF_FONTS.LIBRARY_TITLE
  y += titleSize - PDF_FONTS.TITLE
  doc.setFontSize(titleSize)
  doc.setTextColor(PDF_COLORS.BLACK)
  doc.setFont('helvetica', 'bold')
  doc.text(options.name, margin, y)
  y += titleSize * PDF_SPACING.LINE_HEIGHT + 4

  // Meta line: just the date if provided (libraries have no version/OID)
  if (options.date) {
    doc.setFontSize(PDF_FONTS.META)
    doc.setTextColor(PDF_COLORS.GRAY_DARK)
    doc.setFont('helvetica', 'normal')
    doc.text(options.date, margin, y)
    y += PDF_FONTS.META * PDF_SPACING.LINE_HEIGHT + 2
  }

  // Subtitle (dynamic, e.g. "Action Library", "Environment Library")
  doc.setFontSize(PDF_FONTS.META)
  doc.setTextColor(PDF_COLORS.GRAY_DARK)
  doc.setFont('helvetica', 'normal')
  doc.text(options.subtitle, margin, y)
  y += PDF_FONTS.META * PDF_SPACING.LINE_HEIGHT + 6

  // Description (word-wrapped)
  if (options.description) {
    doc.setFontSize(PDF_FONTS.BODY)
    doc.setTextColor(PDF_COLORS.BLACK)
    doc.setFont('helvetica', 'normal')
    const lines = doc.splitTextToSize(options.description, pageWidth)
    doc.text(lines, margin, y)
    y += lines.length * PDF_FONTS.BODY * PDF_SPACING.LINE_HEIGHT + 6
  }

  return y
}

/**
 * Renders a bold section header with a horizontal rule beneath it.
 *
 * @param doc - jsPDF document
 * @param text - Section header text
 * @param y - Starting Y position
 * @returns Y position after the header + rule + gap
 */
export function renderSectionHeader(doc: jsPDF, text: string, y: number): number {
  const margin = PDF_SPACING.PAGE_MARGIN
  const lineEnd = PDF_PAGE.LETTER_WIDTH - PDF_SPACING.PAGE_MARGIN

  // Bold section header text
  doc.setFontSize(PDF_FONTS.SECTION_HEADER)
  doc.setTextColor(PDF_COLORS.BLACK)
  doc.setFont('helvetica', 'bold')
  doc.text(text, margin, y)
  y += PDF_FONTS.SECTION_HEADER * PDF_SPACING.LINE_HEIGHT + 2

  // Horizontal rule
  doc.setDrawColor(PDF_COLORS.BORDER_LIGHT)
  doc.setLineWidth(0.5)
  doc.line(margin, y, lineEnd, y)
  y += PDF_SPACING.SECTION_GAP_AFTER

  return y
}

/**
 * Heading for one item (an action or an environment) in a library PDF: a solid rule
 * across the page, then the name in a larger bold font, its version, and its
 * description. Text is drawn at its baseline, so the name sits a full font height below
 * the rule — its capitals never touch it.
 *
 * `nested` is for an action listed inside an environment: indented, a lighter rule and a
 * smaller name, so the environment stays the stronger heading.
 *
 * @returns Y position after the header
 */
export function renderItemHeader(
  doc: jsPDF,
  item: { name: string; version?: string | null; description?: string | null },
  y: number,
  options?: { nested?: boolean },
): number {
  const nested = options?.nested ?? false
  const left = PDF_SPACING.PAGE_MARGIN + (nested ? 12 : 0)
  const right = PDF_PAGE.LETTER_WIDTH - PDF_SPACING.PAGE_MARGIN
  const nameSize = nested ? PDF_FONTS.SECTION_HEADER + 1 : PDF_FONTS.ITEM_TITLE

  y += 4
  doc.setDrawColor(PDF_COLORS.BLACK)
  doc.setLineWidth(nested ? 1 : 2.5)
  doc.line(left, y, right, y)
  y += 6 + nameSize

  doc.setFontSize(nameSize)
  doc.setTextColor(PDF_COLORS.BLACK)
  doc.setFont('helvetica', 'bold')
  doc.text(item.name, left, y)
  y += nameSize * (PDF_SPACING.LINE_HEIGHT - 1) + 2

  const version = item.version?.trim()
  if (version) {
    y += PDF_FONTS.META
    doc.setFontSize(PDF_FONTS.META)
    doc.setTextColor(PDF_COLORS.GRAY_DARK)
    doc.setFont('helvetica', 'normal')
    doc.text(`Version ${version}`, left, y)
    y += 2
  }

  const description = item.description?.trim()
  if (description) {
    doc.setFontSize(PDF_FONTS.BODY)
    doc.setTextColor(PDF_COLORS.BLACK)
    doc.setFont('helvetica', 'normal')
    const lines = doc.splitTextToSize(description, right - left)
    y += PDF_FONTS.BODY + 2
    doc.text(lines, left, y)
    y += (lines.length - 1) * PDF_FONTS.BODY * PDF_SPACING.LINE_HEIGHT
  }

  return y + 8
}

// ---------------------------------------------------------------------------
// Footer stamping
// ---------------------------------------------------------------------------

/**
 * Stamps all pages with a footer containing the spec name and page number.
 * Must be called after all content has been added (so total page count is known).
 *
 * @param doc - jsPDF document
 * @param specName - Workflow/library specification name
 */
export function stampPageFooters(doc: jsPDF, specName: string): void {
  const totalPages = doc.getNumberOfPages()
  const footerY = PDF_PAGE.LETTER_HEIGHT - 25
  const margin = PDF_SPACING.PAGE_MARGIN
  const rightEdge = PDF_PAGE.LETTER_WIDTH - PDF_SPACING.PAGE_MARGIN

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)
    doc.setFontSize(PDF_FONTS.FOOTER)
    doc.setFont('helvetica', 'normal')

    // Left footer: "Mission Designer - {specName}"
    doc.setTextColor(PDF_COLORS.GRAY_MID)
    doc.text(`Mission Designer - ${specName}`, margin, footerY)

    // Right footer: "Page X of Y" (right-aligned)
    const pageLabel = `Page ${i} of ${totalPages}`
    doc.text(pageLabel, rightEdge, footerY, { align: 'right' })
  }
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/**
 * Triggers a browser download of the PDF document.
 *
 * @param doc - jsPDF document
 * @param filename - Output filename (`.pdf` appended if missing)
 */
export function downloadPDF(doc: jsPDF, filename: string): void {
  const name = filename.endsWith('.pdf') ? filename : `${filename}.pdf`
  doc.save(name)
}
