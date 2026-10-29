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
 * Diagram page renderer for the Workflow PDF.
 *
 * Captures the main workflow diagram as a high-resolution PNG from the
 * React Flow DOM, scales it to fill portrait page width (540pt), and
 * splits tall/wide diagrams across multiple pages with continuation markers.
 * Also provides a child workflow diagram renderer using the canvas minimap.
 *
 * WDIAG-01 through WDIAG-04
 */

import jsPDF from 'jspdf'
import type { Edge } from '@xyflow/react'
import type { WorkflowNode } from '@/types/nodes'
import type { Notation } from '@/types/notation'
import { exportToPng } from '@/lib/export/image-export'
import { renderMinimapFullPage } from './pdf-canvas-minimap'
import { addPortraitPage, renderSectionHeader } from './pdf-export'
import { PDF_COLORS, PDF_FONTS, PDF_PAGE, PDF_SPACING, type WorkflowPDFOptions } from './pdf-types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Loads a data URL into an HTMLImageElement.
 * Returns a promise that resolves when the image is fully loaded.
 */
function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = dataUrl
  })
}

/**
 * Extracts a rectangular region of a source image into a new data URL.
 * Uses document.createElement('canvas') for maximum browser compatibility.
 *
 * @param dataUrl - Source image data URL
 * @param srcX - Source pixel X offset
 * @param srcY - Source pixel Y offset
 * @param srcW - Source pixel width to extract
 * @param srcH - Source pixel height to extract
 * @returns Data URL of the extracted region
 */
async function sliceImage(dataUrl: string, srcX: number, srcY: number, srcW: number, srcH: number): Promise<string> {
  const img = await loadImage(dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = srcW
  canvas.height = srcH
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH)
  return canvas.toDataURL('image/png')
}

// ---------------------------------------------------------------------------
// Continuation marker helpers
// ---------------------------------------------------------------------------

/**
 * Renders "Continued on next page ▼" at the bottom of the current page.
 */
function renderContinuedBelow(doc: jsPDF, y: number): void {
  const margin = PDF_SPACING.PAGE_MARGIN
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(PDF_FONTS.CONTINUATION)
  doc.setTextColor(PDF_COLORS.GRAY_MID)
  doc.text('Continued on next page \u25BC', margin, y)
}

/**
 * Renders "▲ Continued from previous page" at the top of the current page.
 */
function renderContinuedAbove(doc: jsPDF, y: number): void {
  const margin = PDF_SPACING.PAGE_MARGIN
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(PDF_FONTS.CONTINUATION)
  doc.setTextColor(PDF_COLORS.GRAY_MID)
  doc.text('\u25B2 Continued from previous page', margin, y)
}

// ---------------------------------------------------------------------------
// Vertical strip strategy (TB diagrams — flowchart, isa88)
// ---------------------------------------------------------------------------

async function renderVerticalStrips(
  doc: jsPDF,
  dataUrl: string,
  img: HTMLImageElement,
  startY: number,
): Promise<number> {
  const margin = PDF_SPACING.PAGE_MARGIN
  const pageContentWidth = PDF_PAGE.portraitWidth
  // Scale image to fill page width
  const scaledHeight = (img.naturalHeight / img.naturalWidth) * pageContentWidth
  // Available height per page (leave room for continuation text above/below)
  const continuationLineH = PDF_FONTS.CONTINUATION * PDF_SPACING.LINE_HEIGHT + 4
  const availablePageH = PDF_PAGE.portraitHeight - continuationLineH * 2

  if (scaledHeight <= availablePageH) {
    // Fits on one page — render directly
    doc.addImage(dataUrl, 'PNG', margin, startY, pageContentWidth, scaledHeight)
    return startY + scaledHeight
  }

  // Must split into horizontal strips
  // Each strip covers (availablePageH / scaledHeight) fraction of the image height
  const stripFraction = availablePageH / scaledHeight
  const stripPixelH = Math.floor(img.naturalHeight * stripFraction)
  const totalStrips = Math.ceil(img.naturalHeight / stripPixelH)

  let currentY = startY

  for (let i = 0; i < totalStrips; i++) {
    const srcY = i * stripPixelH
    const srcH = Math.min(stripPixelH, img.naturalHeight - srcY)
    const srcW = img.naturalWidth

    // Extract the strip
    const stripDataUrl = await sliceImage(dataUrl, 0, srcY, srcW, srcH)

    // Compute scaled dimensions for this strip
    const scaledStripH = (srcH / img.naturalWidth) * pageContentWidth

    if (i === 0) {
      // First strip: use startY (section header already rendered on this page)
      // Show continuation below if there are more strips
      if (totalStrips > 1) {
        const belowY = currentY + scaledStripH + 2
        doc.addImage(stripDataUrl, 'PNG', margin, currentY, pageContentWidth, scaledStripH)
        renderContinuedBelow(doc, belowY)
        currentY = belowY + continuationLineH
      } else {
        doc.addImage(stripDataUrl, 'PNG', margin, currentY, pageContentWidth, scaledStripH)
        currentY = currentY + scaledStripH
      }
    } else {
      // Subsequent strips: new page
      currentY = addPortraitPage(doc)
      renderContinuedAbove(doc, currentY)
      currentY += continuationLineH

      doc.addImage(stripDataUrl, 'PNG', margin, currentY, pageContentWidth, scaledStripH)

      if (i < totalStrips - 1) {
        // More strips follow
        const belowY = currentY + scaledStripH + 2
        renderContinuedBelow(doc, belowY)
        currentY = belowY + continuationLineH
      } else {
        currentY = currentY + scaledStripH
      }
    }
  }

  return currentY
}

// ---------------------------------------------------------------------------
// Horizontal slice strategy (BPMN diagrams — LR layout)
// ---------------------------------------------------------------------------

async function renderHorizontalSlices(
  doc: jsPDF,
  dataUrl: string,
  img: HTMLImageElement,
  startY: number,
): Promise<number> {
  const margin = PDF_SPACING.PAGE_MARGIN
  const pageContentWidth = PDF_PAGE.portraitWidth
  const continuationLineH = PDF_FONTS.CONTINUATION * PDF_SPACING.LINE_HEIGHT + 4
  // Available height per slice (reserve room for continuation text + divider)
  const dividerH = 2 + 4 // 2pt line + 4pt gap
  const availableSliceH = PDF_PAGE.portraitHeight - continuationLineH * 2 - 40

  // Scale image to fill available height
  const scaledWidth = (img.naturalWidth / img.naturalHeight) * availableSliceH

  if (scaledWidth <= pageContentWidth) {
    // Fits on one page — render directly
    doc.addImage(dataUrl, 'PNG', margin, startY, scaledWidth, availableSliceH)
    return startY + availableSliceH
  }

  // Must split into vertical slices
  // Each slice covers (pageContentWidth / scaledWidth) fraction of the image width
  const sliceFraction = pageContentWidth / scaledWidth
  const slicePixelW = Math.floor(img.naturalWidth * sliceFraction)
  const totalSlices = Math.ceil(img.naturalWidth / slicePixelW)

  let currentY = startY
  let slicesOnCurrentPage = 0

  for (let i = 0; i < totalSlices; i++) {
    const srcX = i * slicePixelW
    const srcW = Math.min(slicePixelW, img.naturalWidth - srcX)
    const srcH = img.naturalHeight

    // Extract the slice
    const sliceDataUrl = await sliceImage(dataUrl, srcX, 0, srcW, srcH)

    // Compute scaled dimensions for this slice (maintain aspect ratio)
    const scaledSliceW = pageContentWidth
    const scaledSliceH = (srcH / srcW) * scaledSliceW

    // Check if slice fits on current page
    const spaceNeeded = scaledSliceH + (slicesOnCurrentPage > 0 ? dividerH : 0) + continuationLineH
    const pageBottom = PDF_PAGE.LETTER_HEIGHT - PDF_SPACING.PAGE_MARGIN - 30
    const wouldExceed = currentY + spaceNeeded > pageBottom

    if (i > 0 && wouldExceed) {
      // Render "continued" at bottom of current page and start new page
      renderContinuedBelow(doc, currentY)
      currentY = addPortraitPage(doc)
      slicesOnCurrentPage = 0
      renderContinuedAbove(doc, currentY)
      currentY += continuationLineH
    } else if (i > 0 && slicesOnCurrentPage > 0) {
      // Add heavy divider line between slices on same page
      doc.setLineWidth(2)
      doc.setDrawColor(PDF_COLORS.BLACK)
      doc.line(margin, currentY, margin + pageContentWidth, currentY)
      doc.setLineWidth(0.5) // reset
      currentY += 4
    }

    doc.addImage(sliceDataUrl, 'PNG', margin, currentY, scaledSliceW, scaledSliceH)
    currentY += scaledSliceH
    slicesOnCurrentPage++
  }

  return currentY
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Renders the workflow diagram section into the PDF document.
 * Adds a "Workflow Diagram" section header, captures the diagram via
 * html-to-image at high resolution, then applies either:
 *   - Vertical strip strategy for TB (flowchart/isa88) diagrams
 *   - Horizontal slice strategy for LR (BPMN) diagrams
 *
 * @param doc - jsPDF document instance
 * @param options - Workflow PDF options (must include nodes; notation drives layout strategy)
 * @returns Promise resolving to the Y position after the last diagram content
 */
export async function renderDiagramPages(doc: jsPDF, options: WorkflowPDFOptions): Promise<number> {
  const margin = PDF_SPACING.PAGE_MARGIN

  // Start diagram section on a new page (cover + tables are on previous pages)
  addPortraitPage(doc)
  let y: number = margin

  // Section header (on the current page — same page as first strip)
  y = renderSectionHeader(doc, 'Workflow Diagram', y)

  // Capture the main workflow diagram PNG from the React Flow DOM
  const dataUrl = await exportToPng(options.nodes, { width: 2400, height: 1800 })
  const img = await loadImage(dataUrl)

  const isBpmn = options.notation === 'bpmn'

  if (isBpmn) {
    y = await renderHorizontalSlices(doc, dataUrl, img, y)
  } else {
    y = await renderVerticalStrips(doc, dataUrl, img, y)
  }

  return y
}

/**
 * Renders a child workflow diagram on a new full page using the canvas minimap.
 * Used in Phase 29 for child workflow sections.
 *
 * @param doc - jsPDF document instance
 * @param nodes - Child workflow nodes
 * @param edges - Child workflow edges
 * @param notation - Active notation for shape rendering
 * @returns Y position after the diagram content
 */
export function renderChildDiagramPage(doc: jsPDF, nodes: WorkflowNode[], edges: Edge[], notation: Notation): number {
  const margin = PDF_SPACING.PAGE_MARGIN
  const y = addPortraitPage(doc)

  renderMinimapFullPage(doc, nodes, edges, notation, margin, y, PDF_PAGE.portraitWidth, PDF_PAGE.portraitHeight)

  return y + PDF_PAGE.portraitHeight
}
