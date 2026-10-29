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
 * Step detail page renderer for the Workflow PDF.
 *
 * Renders each non-trivial step with a minimap thumbnail, type-specific content
 * (form grids, script blocks, options tables), and parameter/resource tables.
 * Control flow steps are grouped compactly at the end.
 *
 * WSTEP-01 through WSTEP-06
 */

import jsPDF from 'jspdf'
import type { Edge } from '@xyflow/react'
import type { WorkflowNode } from '@/types/nodes'
import { resolveAt, JOB_DEFAULT_LABEL } from '@mission/form-schema'
import type { Block, FormDocument, GridSpan } from '@mission/form-schema'
import { PDF_COLORS, PDF_FONTS, PDF_PAGE, PDF_SPACING, type WorkflowPDFOptions } from './pdf-types'
import { ensureSpace, renderSectionHeader } from './pdf-export'
import {
  renderLabeledTable,
  buildInputParamsTable,
  buildOutputParamsTable,
  buildResourceCommandsTable,
} from './pdf-tables'
import { renderMinimapThumbnail } from './pdf-canvas-minimap'
import { derivePreviewDecision } from '@/components/form-designer/v2/preview/previewDecision'
import { topologicalSort } from './topological-sort'
import { formatDuration, joinDuration } from '@/lib/duration'
import type { StepNodeData } from '@/types/nodes'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MARGIN = PDF_SPACING.PAGE_MARGIN
const THUMBNAIL_WIDTH = 120
const THUMBNAIL_HEIGHT = 90
const CONTENT_WIDTH = PDF_PAGE.portraitWidth

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The detail lines under a gate step (spec 2026-10-13 §4.4). A plain condition gate keeps its
 * single "Cycle time" line; a timer gate states the delay only (no script runs); a
 * condition-with-timeout gate states the delay and the cycle. Exported for tests.
 */
export function gateDetailLines(data: StepNodeData): string[] {
  const cycleSeconds = data.gateCycleSeconds ?? 5
  const mode = data.gateMode ?? 'condition'
  const delayText = formatDuration(joinDuration(data.gateDelay))
  if (mode === 'timer') return [`Mode: Timer, delay ${delayText}`]
  if (mode === 'condition_or_timer') {
    return [`Mode: Condition with timeout, delay ${delayText}`, `Cycle time: ${cycleSeconds} seconds`]
  }
  return [`Cycle time: ${cycleSeconds} seconds`]
}

/**
 * The detail lines under a script step (spec 2026-10-13 §6.6): nothing for a one-shot script; a
 * repeating script states its cycle and, when it has one, its time limit and outcome. Exported
 * for tests.
 */
export function scriptDetailLines(data: StepNodeData): string[] {
  if (data.scriptRepeat !== true) return []
  const lines = [`Repeat until done, checking every ${data.scriptCycleSeconds ?? 5} seconds`]
  const limit = joinDuration(data.scriptTimeLimit)
  if (limit > 0) {
    const outcome = data.scriptOnTimeLimit === 'complete' ? 'complete with current outputs' : 'fail the step'
    lines.push(`Time limit: ${formatDuration(limit)}, then ${outcome}`)
  }
  return lines
}

/**
 * Strips HTML tags from a string for plain-text rendering. Paragraph boundaries and <br>
 * become newlines (jsPDF's splitTextToSize honors \n, so multi-paragraph WYSIWYG content
 * keeps its breaks), and basic entities decode so `Tom &amp; Jerry` prints as authored —
 * deferred final-review finding M5. `&amp;` decodes last to avoid double-decoding.
 * Exported for tests only.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<\/p>\s*<p\b[^>]*>/g, '\n')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim()
}

/**
 * Returns the display badge label for a node type.
 */
function getTypeLabel(nodeType: string): string {
  switch (nodeType) {
    case 'actionProxyWait':
      return '[Action]'
    case 'userInteractionStep':
      return '[User Interaction]'
    case 'yesNoStep':
      return '[Yes/No]'
    case 'scriptStep':
      return '[Script]'
    case 'gateStep':
      return '[Gate]'
    case 'workflowProxy':
      return '[Workflow Proxy]'
    case 'select1':
      return '[Select1]'
    case 'start':
      return '[Start]'
    case 'end':
      return '[End]'
    case 'parallel':
      return '[Parallel]'
    case 'waitAll':
      return '[Wait All]'
    case 'waitAny':
      return '[Wait Any]'
    default:
      return `[${nodeType}]`
  }
}

/**
 * Returns true for non-trivial steps that get full detail sections.
 */
function isNonTrivialStep(nodeType: string): boolean {
  return (
    nodeType === 'actionProxyWait' ||
    nodeType === 'userInteractionStep' ||
    nodeType === 'yesNoStep' ||
    nodeType === 'scriptStep' ||
    nodeType === 'gateStep' ||
    nodeType === 'workflowProxy' ||
    nodeType === 'select1'
  )
}

/**
 * Returns true for control flow nodes grouped at the end.
 */
function isControlStep(nodeType: string): boolean {
  return (
    nodeType === 'start' ||
    nodeType === 'end' ||
    nodeType === 'parallel' ||
    nodeType === 'waitAll' ||
    nodeType === 'waitAny'
  )
}

// ---------------------------------------------------------------------------
// Form document renderer (v2) \u2014 schematic tablet-resolution rendering.
// Rows become horizontal bands; block x/width are proportional 12-col spans
// resolved at 'tablet' via the ONE cascade (resolveAt). Heights are per-type
// intrinsic estimates \u2014 the PDF is schematic, not pixel-true (v1 parity).
// ---------------------------------------------------------------------------

const TYPE_PT: Record<string, number> = { xs: 6, sm: 6.5, md: 7, lg: 8, xl: 9, '2xl': 10, '3xl': 11 }
const FORM_GUTTER = 2

/** The step a form belongs to; lets a job button without its own label print the step's label. */
export interface FormStepContext {
  nodeType: string
  data: Pick<StepNodeData, 'uiParameters' | 'yesNoYesValue' | 'yesNoNoValue'>
}

/** A job button with an empty label follows the step's label (as Pilot shows it); typed text wins. */
function buttonPrintLabel(block: Extract<Block, { type: 'button' }>, step: FormStepContext | undefined): string {
  if (block.label) return block.label
  if (!block.job) return ''
  const decision = step ? derivePreviewDecision(step.nodeType, step.data) : undefined
  if (decision?.kind === 'yesno' && block.job !== 'continue') return decision[block.job].label
  if (decision?.kind === 'continue' && block.job === 'continue') return decision.label
  return JOB_DEFAULT_LABEL[block.job]
}

function blockFontSize(size: string | undefined, fallback: number): number {
  return size ? (TYPE_PT[size] ?? fallback) : fallback
}

function parseAspect(aspectRatio: string | undefined): number {
  if (!aspectRatio) return 16 / 9
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(aspectRatio)
  if (!m) return 16 / 9
  const w = Number(m[1])
  const h = Number(m[2])
  return w > 0 && h > 0 ? w / h : 16 / 9
}

// ---------------------------------------------------------------------------
// E-signature box sizing — shared by blockIntrinsicHeight (measure) and
// renderFormBlock (draw) so the border always encloses the content it wraps to
// (fix round 1, finding 2: a fixed 26pt box overflowed a wrapped `meaning`).
// ---------------------------------------------------------------------------

const ESIG_LABEL_AREA = 11 // border top -> first content line (label sits above this)
const ESIG_LINE_H = 5 // per-line height for meaning/role/flag lines
const ESIG_BOTTOM_PAD = 5 // clearance between the last content line and the signature line

/** Wrapped lines of `meaning` at the block's content width (font set to match the render
 *  case's 6pt normal weight so measured wrapping matches drawn wrapping). Empty when absent. */
function esignatureMeaningLines(doc: jsPDF, meaning: string | undefined, width: number): string[] {
  if (!meaning) return []
  doc.setFontSize(6)
  doc.setFont('helvetica', 'normal')
  return doc.splitTextToSize(meaning, width - 4)
}

/** Intrinsic height of an e-signature box: label area + wrapped meaning lines + the Role
 *  line + the optional different-user line + clearance above the signature line. */
function esignatureBoxHeight(
  doc: jsPDF,
  block: { meaning?: string; requireDifferentUser?: boolean },
  width: number,
): number {
  const meaningLines = esignatureMeaningLines(doc, block.meaning, width)
  return (
    ESIG_LABEL_AREA +
    meaningLines.length * ESIG_LINE_H +
    ESIG_LINE_H + // Role line
    (block.requireDifferentUser ? ESIG_LINE_H : 0) +
    ESIG_BOTTOM_PAD
  )
}

function blockIntrinsicHeight(doc: jsPDF, block: Block, width: number): number {
  switch (block.type) {
    case 'text': {
      const fs = blockFontSize(block.size, 7)
      doc.setFontSize(fs)
      const lines = doc.splitTextToSize(stripHtml(block.content ?? ''), width)
      return lines.length * fs * 0.55 + 3
    }
    case 'header': {
      const fs = blockFontSize(block.size, 9)
      doc.setFontSize(fs)
      const lines = doc.splitTextToSize(stripHtml(block.content ?? ''), width)
      return lines.length * fs * 0.55 + 3
    }
    case 'textInput':
      return 12
    case 'textarea':
      return (block.rows ?? 4) * 5 + 8
    case 'checkbox':
    case 'radio':
      return (block.options?.length ?? 0) * 8.4 + (block.label ? 8 : 2)
    case 'button':
      return 12
    case 'image':
    case 'video':
      return width / parseAspect(block.layout?.aspectRatio)
    case 'divider':
      return 6
    case 'timer':
      return 12
    case 'esignature':
      return esignatureBoxHeight(doc, block, width)
    default:
      return 10
  }
}

interface PlacedBlock {
  block: Block
  x: number // relative to grid left
  w: number
  h: number
}
interface FormBand {
  blocks: PlacedBlock[]
  height: number
  footerGap: boolean
}

function measureFormBands(doc: jsPDF, formDocument: FormDocument, gridWidth: number): FormBand[] {
  const bands: FormBand[] = []
  let sawContent = false
  for (const section of formDocument.sections) {
    const footerGap = section.role === 'footer' && sawContent
    let firstInSection = true
    if (section.rows.some((r) => r.blocks.length > 0)) sawContent = true
    for (const row of section.rows) {
      const ordered = row.blocks
        .map((b, i) => ({ b, order: resolveAt(b.layout?.order, 'tablet', i) }))
        .filter(({ b }) => resolveAt(b.layout?.visible, 'tablet', true))
        .sort((a, z) => a.order - z.order)
        .map(({ b }) => b)
      if (ordered.length === 0) continue
      // Wrap into 12-col lines (grid auto-flow)
      let col = 0
      let line: Array<{ block: Block; col: number; span: number }> = []
      const lines: Array<typeof line> = []
      for (const block of ordered) {
        const span = resolveAt<GridSpan>(block.layout?.span, 'tablet', 12)
        if (col + span > 12 && line.length > 0) {
          lines.push(line)
          line = []
          col = 0
        }
        line.push({ block, col, span })
        col += span
      }
      if (line.length > 0) lines.push(line)
      for (const l of lines) {
        let height = 0
        const blocks = l.map(({ block, col: c, span }) => {
          const x = (c / 12) * gridWidth + FORM_GUTTER / 2
          const w = (span / 12) * gridWidth - FORM_GUTTER
          const h = blockIntrinsicHeight(doc, block, w)
          height = Math.max(height, h)
          return { block, x, w, h }
        })
        bands.push({ blocks, height, footerGap: footerGap && firstInSection && bands.length > 0 })
        firstInSection = false
      }
    }
  }
  return bands
}

/**
 * Renders the v2 form document as a schematic tablet-resolution grid.
 * @returns Y position after the grid area
 */
export function renderFormDocumentGrid(
  doc: jsPDF,
  formDocument: FormDocument,
  images: Map<string, string> | undefined,
  startY: number,
  step?: FormStepContext,
): number {
  const gridWidth = CONTENT_WIDTH * 0.7
  const gridLeft = MARGIN + (CONTENT_WIDTH - gridWidth) / 2

  const bands = measureFormBands(doc, formDocument, gridWidth)
  if (bands.length === 0) return startY
  const PAD = 4
  const totalHeight = bands.reduce((s, b) => s + b.height + 3 + (b.footerGap ? 4 : 0), PAD * 2)

  const y = ensureSpace(doc, startY, Math.min(totalHeight, 200))
  const gridTop = y

  // Frame + light background (v1 parity)
  doc.setFillColor('#FAFAFA')
  doc.rect(gridLeft, gridTop, gridWidth, totalHeight, 'F')
  doc.setDrawColor(PDF_COLORS.BORDER_LIGHT)
  doc.setLineWidth(0.5)
  doc.rect(gridLeft, gridTop, gridWidth, totalHeight)

  let cursorY = gridTop + PAD
  for (const band of bands) {
    if (band.footerGap) cursorY += 4
    for (const p of band.blocks) {
      renderFormBlock(doc, p.block, gridLeft + p.x, cursorY, p.w, p.h, images, step)
    }
    cursorY += band.height + 3
  }

  return gridTop + totalHeight + 6
}

function renderFormBlock(
  doc: jsPDF,
  block: Block,
  pdfX: number,
  pdfY: number,
  pdfW: number,
  pdfH: number,
  images: Map<string, string> | undefined,
  step?: FormStepContext,
): void {
  switch (block.type) {
    case 'text': {
      const fs = blockFontSize(block.size, 7)
      doc.setFontSize(fs)
      doc.setTextColor(block.color ?? PDF_COLORS.BLACK)
      doc.setFont('helvetica', block.fontWeight === 'bold' ? 'bold' : 'normal')
      const lines = doc.splitTextToSize(stripHtml(block.content ?? ''), pdfW)
      doc.text(lines, pdfX, pdfY + fs, { maxWidth: pdfW })
      break
    }
    case 'header': {
      const fs = blockFontSize(block.size, 9)
      doc.setFontSize(fs)
      doc.setTextColor(block.color ?? PDF_COLORS.BLACK)
      doc.setFont('helvetica', 'bold')
      const lines = doc.splitTextToSize(stripHtml(block.content ?? ''), pdfW)
      doc.text(lines, pdfX, pdfY + fs, { maxWidth: pdfW })
      break
    }
    case 'textInput': {
      if (block.label) {
        doc.setFontSize(6)
        doc.setTextColor(PDF_COLORS.GRAY_DARK)
        doc.setFont('helvetica', 'normal')
        doc.text(block.label, pdfX, pdfY + 5, { maxWidth: pdfW })
      }
      doc.setDrawColor(PDF_COLORS.BORDER_LIGHT)
      doc.setLineWidth(0.5)
      doc.line(pdfX, pdfY + pdfH, pdfX + pdfW, pdfY + pdfH)
      break
    }
    case 'textarea': {
      if (block.label) {
        doc.setFontSize(6)
        doc.setTextColor(PDF_COLORS.GRAY_DARK)
        doc.setFont('helvetica', 'normal')
        doc.text(block.label, pdfX, pdfY + 5, { maxWidth: pdfW })
      }
      doc.setDrawColor(PDF_COLORS.BORDER_LIGHT)
      doc.setLineWidth(0.5)
      doc.rect(pdfX, pdfY + (block.label ? 7 : 0), pdfW, pdfH - (block.label ? 7 : 0))
      break
    }
    case 'checkbox':
    case 'radio': {
      const glyph = block.type === 'checkbox' ? '\u2610' : '\u25CB'
      let optY = pdfY + 6
      if (block.label) {
        doc.setFontSize(6)
        doc.setTextColor(PDF_COLORS.GRAY_DARK)
        doc.setFont('helvetica', 'normal')
        doc.text(block.label, pdfX, optY, { maxWidth: pdfW })
        optY += 8
      }
      doc.setFontSize(6)
      doc.setTextColor(PDF_COLORS.BLACK)
      for (const opt of block.options ?? []) {
        if (optY > pdfY + pdfH) break
        doc.text(`${glyph} ${opt.label}`, pdfX, optY, { maxWidth: pdfW })
        optY += 8.4
      }
      break
    }
    case 'button': {
      doc.setFillColor('#E5E7EB')
      doc.setDrawColor('#9CA3AF')
      doc.setLineWidth(0.5)
      doc.roundedRect(pdfX, pdfY, pdfW, pdfH, 2, 2, 'FD')
      const fs = Math.min(7, pdfH * 0.6)
      doc.setFontSize(fs)
      doc.setTextColor(PDF_COLORS.BLACK)
      doc.setFont('helvetica', 'bold')
      doc.text(buttonPrintLabel(block, step), pdfX + pdfW / 2, pdfY + pdfH / 2 + fs * 0.35, {
        align: 'center',
        maxWidth: pdfW - 4,
      })
      break
    }
    case 'image': {
      const dataUri = block.src ? images?.get(block.src) : undefined
      if (dataUri) {
        try {
          doc.addImage(dataUri, 'PNG', pdfX, pdfY, pdfW, pdfH)
          break
        } catch {
          // fall through to placeholder
        }
      }
      doc.setFillColor('#F3F4F6')
      doc.setDrawColor(PDF_COLORS.BORDER_LIGHT)
      doc.rect(pdfX, pdfY, pdfW, pdfH, 'FD')
      doc.setFontSize(6)
      doc.setTextColor(PDF_COLORS.GRAY_MID)
      doc.setFont('helvetica', 'normal')
      doc.text('Image', pdfX + pdfW / 2, pdfY + pdfH / 2 + 2, { align: 'center' })
      break
    }
    case 'video': {
      doc.setFillColor('#E5E7EB')
      doc.setDrawColor(PDF_COLORS.BORDER_LIGHT)
      doc.rect(pdfX, pdfY, pdfW, pdfH, 'FD')
      doc.setFontSize(6)
      doc.setTextColor(PDF_COLORS.GRAY_MID)
      doc.setFont('helvetica', 'normal')
      doc.text('\u25BA Video', pdfX + pdfW / 2, pdfY + pdfH / 2 + 2, { align: 'center' })
      break
    }
    case 'divider': {
      const lineY = pdfY + pdfH / 2
      doc.setDrawColor(block.color ?? PDF_COLORS.BORDER_LIGHT)
      doc.setLineWidth(block.weight === 'thick' ? 1.2 : 0.5)
      doc.line(pdfX, lineY, pdfX + pdfW, lineY)
      doc.setLineWidth(0.5)
      break
    }
    case 'timer': {
      doc.setFillColor('#EFF6FF')
      doc.setDrawColor('#BFDBFE')
      doc.rect(pdfX, pdfY, pdfW, pdfH, 'FD')
      doc.setFontSize(6)
      doc.setTextColor(PDF_COLORS.GRAY_DARK)
      doc.setFont('helvetica', 'normal')
      doc.text(`\u23F1 ${block.label ?? 'Timer'}`, pdfX + pdfW / 2, pdfY + pdfH / 2 + 2, {
        align: 'center',
        maxWidth: pdfW - 4,
      })
      break
    }
    case 'esignature': {
      doc.setDrawColor(PDF_COLORS.BORDER_LIGHT)
      doc.setLineWidth(0.5)
      doc.rect(pdfX, pdfY, pdfW, pdfH)
      doc.setFontSize(7)
      doc.setTextColor(PDF_COLORS.BLACK)
      doc.setFont('helvetica', 'bold')
      doc.text(block.label || 'E-signature', pdfX + 2, pdfY + 6, { maxWidth: pdfW - 4 })
      const meaningLines = esignatureMeaningLines(doc, block.meaning, pdfW)
      doc.setFontSize(6)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(PDF_COLORS.GRAY_DARK)
      let y = pdfY + ESIG_LABEL_AREA
      if (meaningLines.length > 0) {
        doc.text(meaningLines, pdfX + 2, y, { maxWidth: pdfW - 4 })
        y += meaningLines.length * ESIG_LINE_H
      }
      doc.text(`Role: ${block.roleName || 'any work-center member'}`, pdfX + 2, y, { maxWidth: pdfW - 4 })
      y += ESIG_LINE_H
      if (block.requireDifferentUser) {
        doc.text('Requires a different user than the operator', pdfX + 2, y, { maxWidth: pdfW - 4 })
      }
      // The signature line itself.
      doc.line(pdfX + 2, pdfY + pdfH - 3, pdfX + pdfW - 2, pdfY + pdfH - 3)
      break
    }
  }
}

// ---------------------------------------------------------------------------
// Script block renderer
// ---------------------------------------------------------------------------

/**
 * Renders a monospace script block with CODE_BG background.
 * Handles page breaks mid-source without truncation.
 *
 * @returns Y position after the block
 */
function renderScriptBlock(doc: jsPDF, source: string, startY: number): number {
  const lineHeight = PDF_FONTS.CODE * PDF_SPACING.LINE_HEIGHT + 1
  let y = ensureSpace(doc, startY, 60)

  const pageBottom = PDF_PAGE.LETTER_HEIGHT - MARGIN - 30
  const lines = source.split('\n')

  doc.setFillColor(PDF_COLORS.CODE_BG)
  doc.setDrawColor(PDF_COLORS.BORDER_LIGHT)
  doc.setLineWidth(0.5)

  // We'll draw the background rect after determining how far we go on this page
  // So track renders and draw the rect first, then content
  // Instead: draw a full-height rect to the page bottom, then clip it at actual end
  // Simpler approach: draw line-by-line and let background show through

  // Render each line
  doc.setFont('courier', 'normal')
  doc.setFontSize(PDF_FONTS.CODE)
  doc.setTextColor(PDF_COLORS.BLACK)

  const bgRectX = MARGIN
  const bgRectW = CONTENT_WIDTH

  const drawBackgroundRect = (fromY: number, toY: number) => {
    doc.setFillColor(PDF_COLORS.CODE_BG)
    doc.setDrawColor(PDF_COLORS.BORDER_LIGHT)
    doc.setLineWidth(0.5)
    doc.rect(bgRectX, fromY - 2, bgRectW, toY - fromY + 4, 'FD')
  }

  // Draw lines with page-break handling
  const allWrappedLines: string[] = []
  for (const line of lines) {
    const wrapped = doc.splitTextToSize(line || ' ', CONTENT_WIDTH - 10)
    for (const wl of wrapped) {
      allWrappedLines.push(wl)
    }
  }

  // First pass: collect Y positions to draw background first
  // For simplicity, draw background at start of each "page section", then overlay text
  const currentBlockStart = y

  // Draw the background block for ALL lines first (approximated)
  const totalLinesH = allWrappedLines.length * lineHeight
  const firstPageLines = Math.floor((pageBottom - y - 4) / lineHeight)

  if (totalLinesH <= pageBottom - y - 4) {
    // All fits on current page
    drawBackgroundRect(y, y + totalLinesH)
    doc.setFont('courier', 'normal')
    doc.setFontSize(PDF_FONTS.CODE)
    doc.setTextColor(PDF_COLORS.BLACK)
    for (const wl of allWrappedLines) {
      doc.text(wl, MARGIN + 5, y + PDF_FONTS.CODE)
      y += lineHeight
    }
  } else {
    // Multi-page rendering
    const firstBatch = allWrappedLines.slice(0, Math.max(firstPageLines, 1))
    const firstBatchH = firstBatch.length * lineHeight
    drawBackgroundRect(currentBlockStart, currentBlockStart + firstBatchH)
    doc.setFont('courier', 'normal')
    doc.setFontSize(PDF_FONTS.CODE)
    doc.setTextColor(PDF_COLORS.BLACK)
    for (const wl of firstBatch) {
      doc.text(wl, MARGIN + 5, y + PDF_FONTS.CODE)
      y += lineHeight
    }

    let remaining = allWrappedLines.slice(firstBatch.length)
    while (remaining.length > 0) {
      // New page
      doc.addPage([PDF_PAGE.LETTER_WIDTH, PDF_PAGE.LETTER_HEIGHT], 'portrait')
      y = MARGIN

      const linesPerPage = Math.floor((PDF_PAGE.portraitHeight - 4) / lineHeight)
      const batch = remaining.slice(0, linesPerPage)
      const batchH = batch.length * lineHeight

      drawBackgroundRect(y, y + batchH)
      doc.setFont('courier', 'normal')
      doc.setFontSize(PDF_FONTS.CODE)
      doc.setTextColor(PDF_COLORS.BLACK)
      for (const wl of batch) {
        doc.text(wl, MARGIN + 5, y + PDF_FONTS.CODE)
        y += lineHeight
      }
      remaining = remaining.slice(batch.length)
    }
  }

  return y + 4
}

// ---------------------------------------------------------------------------
// Select1 options table renderer
// ---------------------------------------------------------------------------

/**
 * Renders the Select1 input name and options table (option label → target step name).
 *
 * @returns Y position after the table
 */
function renderSelect1Table(
  doc: jsPDF,
  node: WorkflowNode,
  allEdges: Edge[],
  allNodes: WorkflowNode[],
  startY: number,
): number {
  let y = startY

  // Show input parameter name
  const inputName = node.data.select1InputName ?? '(not set)'
  const inputValueType = node.data.select1InputValueType ?? 'literal'
  doc.setFontSize(PDF_FONTS.BODY)
  doc.setTextColor(PDF_COLORS.GRAY_DARK)
  doc.setFont('helvetica', 'normal')
  doc.text(`Input: ${inputName} (${inputValueType})`, MARGIN, y)
  y += PDF_FONTS.BODY * PDF_SPACING.LINE_HEIGHT + 4

  // Build options table
  const nodeMap = new Map<string, WorkflowNode>()
  for (const n of allNodes) {
    nodeMap.set(n.id, n)
  }

  const options = node.data.select1Options ?? []
  const tableBody = options.map((opt) => {
    const edge = allEdges.find((e) => e.sourceHandle === opt.id)
    const targetNode = edge ? nodeMap.get(edge.target) : undefined
    const targetName = targetNode ? targetNode.data.label : edge ? edge.target : '—'
    return [opt.label, targetName]
  })

  if (tableBody.length > 0) {
    y = renderLabeledTable(doc, 'Options', { head: [['Option Label', 'Target Step Name']], body: tableBody }, y)
  }

  return y
}

// ---------------------------------------------------------------------------
// Control step group renderer
// ---------------------------------------------------------------------------

/**
 * Renders control flow steps compactly grouped, up to 6 per block.
 *
 * @returns Y position after all control steps
 */
function renderControlStepGroup(doc: jsPDF, controlNodes: WorkflowNode[], startY: number): number {
  if (controlNodes.length === 0) return startY

  let y = ensureSpace(doc, startY, 60)
  y = renderSectionHeader(doc, 'Control Flow Steps', y)

  const BLOCK_SIZE = 6
  for (let i = 0; i < controlNodes.length; i++) {
    if (i > 0 && i % BLOCK_SIZE === 0) {
      y = ensureSpace(doc, y, BLOCK_SIZE * (PDF_FONTS.BODY * PDF_SPACING.LINE_HEIGHT + 2))
    }

    const cn = controlNodes[i]
    const typeLabel = getTypeLabel(cn.type ?? '')
    const idPart = cn.id
    doc.setFontSize(PDF_FONTS.BODY)
    doc.setTextColor(PDF_COLORS.BLACK)
    doc.setFont('helvetica', 'normal')
    doc.text(`${typeLabel} — ${idPart}`, MARGIN, y)
    y += PDF_FONTS.BODY * PDF_SPACING.LINE_HEIGHT + 2
  }

  return y + 4
}

// ---------------------------------------------------------------------------
// Step detail section renderer
// ---------------------------------------------------------------------------

/** Gap between the section's top and the step's rule. */
const STEP_RULE_OFFSET = 4

/**
 * A step's heading in the workflow PDF: a thick full-width rule, then the step name in the
 * item-title size, wrapped to `nameWidth`, its baseline a full font height below the rule so
 * the two never touch (same look as each action in a library PDF).
 *
 * @returns Y position below the name
 */
export function renderStepHeading(doc: jsPDF, label: string, y: number, nameWidth: number): number {
  const ruleY = y + STEP_RULE_OFFSET
  doc.setDrawColor(PDF_COLORS.BLACK)
  doc.setLineWidth(2.5)
  doc.line(MARGIN, ruleY, MARGIN + CONTENT_WIDTH, ruleY)

  const size = PDF_FONTS.ITEM_TITLE
  doc.setFontSize(size)
  doc.setTextColor(PDF_COLORS.BLACK)
  doc.setFont('helvetica', 'bold')
  const nameLines = doc.splitTextToSize(label, nameWidth)
  const baseline = ruleY + 6 + size
  doc.text(nameLines, MARGIN, baseline)
  return baseline + (nameLines.length - 1) * size * PDF_SPACING.LINE_HEIGHT + size * (PDF_SPACING.LINE_HEIGHT - 1) + 4
}

/**
 * Renders a full step detail section for one non-trivial step.
 *
 * @returns Y position after the section
 */
function renderStepDetailSection(doc: jsPDF, node: WorkflowNode, options: WorkflowPDFOptions, startY: number): number {
  const notation = options.notation ?? 'flowchart'
  let y = ensureSpace(doc, startY, 120)

  // -----------------------------------------------------------------------
  // Step header (two-column layout)
  // -----------------------------------------------------------------------
  const leftColWidth = CONTENT_WIDTH - THUMBNAIL_WIDTH - 20
  const thumbX = MARGIN + leftColWidth + 20
  // The thumbnail sits beside the name, below the step's rule.
  const thumbY = y + STEP_RULE_OFFSET + 8

  // Thick rule + step name
  y = renderStepHeading(doc, node.data.label ?? '', y, leftColWidth)

  // Type badge
  const typeLabel = getTypeLabel(node.type ?? '')
  doc.setFontSize(PDF_FONTS.STEP_TYPE_LABEL)
  doc.setTextColor(PDF_COLORS.GRAY_DARK)
  doc.setFont('helvetica', 'normal')
  doc.text(typeLabel, MARGIN, y)
  y += PDF_FONTS.STEP_TYPE_LABEL * PDF_SPACING.LINE_HEIGHT + 2

  // OID
  const oid = node.id
  doc.setFontSize(PDF_FONTS.META)
  doc.setTextColor(PDF_COLORS.GRAY_MID)
  doc.setFont('helvetica', 'normal')
  doc.text(`OID: ${oid}`, MARGIN, y)
  y += PDF_FONTS.META * PDF_SPACING.LINE_HEIGHT + 4

  // Minimap thumbnail (right column)
  try {
    renderMinimapThumbnail(
      doc,
      options.nodes,
      options.edges,
      node.id,
      notation,
      thumbX,
      thumbY,
      THUMBNAIL_WIDTH,
      THUMBNAIL_HEIGHT,
    )
    // "You Are Here" label
    doc.setFontSize(PDF_FONTS.YOU_ARE_HERE)
    doc.setTextColor(PDF_COLORS.GRAY_MID)
    doc.setFont('helvetica', 'normal')
    doc.text('You Are Here', thumbX + THUMBNAIL_WIDTH / 2, thumbY + THUMBNAIL_HEIGHT + 6, { align: 'center' })
  } catch {
    // Non-fatal — continue without thumbnail
  }

  // Ensure y accounts for thumbnail height
  const thumbnailBottomY = thumbY + THUMBNAIL_HEIGHT + 10
  if (y < thumbnailBottomY) {
    y = thumbnailBottomY
  }

  // -----------------------------------------------------------------------
  // Type-specific content
  // -----------------------------------------------------------------------

  const nodeType = node.type ?? ''

  if ((nodeType === 'userInteractionStep' || nodeType === 'yesNoStep') && node.data.formDocument) {
    // Form Grid section header
    y = ensureSpace(doc, y, 30)
    y = renderSectionHeader(doc, 'Form Layout (Tablet)', y)
    y = renderFormDocumentGrid(doc, node.data.formDocument, options.images, y, { nodeType, data: node.data })
  } else if (nodeType === 'scriptStep') {
    const detail = scriptDetailLines(node.data)
    if (detail.length > 0) {
      y = ensureSpace(doc, y, 20)
      doc.setFontSize(PDF_FONTS.BODY)
      doc.setTextColor(PDF_COLORS.GRAY_DARK)
      doc.setFont('helvetica', 'normal')
      for (const line of detail) {
        doc.text(line, MARGIN, y)
        y += PDF_FONTS.BODY * PDF_SPACING.LINE_HEIGHT + 4
      }
    }

    const source = node.data.scriptSource ?? ''
    if (source.trim().length > 0) {
      y = ensureSpace(doc, y, 30)
      y = renderSectionHeader(doc, 'Script Source', y)
      y = renderScriptBlock(doc, source, y)
    }
  } else if (nodeType === 'gateStep') {
    const mode = node.data.gateMode ?? 'condition'
    y = ensureSpace(doc, y, 20)
    doc.setFontSize(PDF_FONTS.BODY)
    doc.setTextColor(PDF_COLORS.GRAY_DARK)
    doc.setFont('helvetica', 'normal')
    for (const line of gateDetailLines(node.data)) {
      doc.text(line, MARGIN, y)
      y += PDF_FONTS.BODY * PDF_SPACING.LINE_HEIGHT + 4
    }

    const source = node.data.scriptSource ?? ''
    if (mode !== 'timer' && source.trim().length > 0) {
      y = ensureSpace(doc, y, 30)
      y = renderSectionHeader(doc, 'Script Source', y)
      y = renderScriptBlock(doc, source, y)
    }
  } else if (nodeType === 'select1') {
    y = ensureSpace(doc, y, 30)
    y = renderSectionHeader(doc, 'Select1 Configuration', y)
    y = renderSelect1Table(doc, node, options.edges, options.nodes, y)
  } else if (nodeType === 'workflowProxy') {
    const childLabel = node.data.label ?? ''
    y = ensureSpace(doc, y, 20)
    doc.setFontSize(PDF_FONTS.BODY)
    doc.setTextColor(PDF_COLORS.GRAY_DARK)
    doc.setFont('helvetica', 'italic')
    doc.text(`Child Workflow: ${childLabel}`, MARGIN, y)
    doc.setFont('helvetica', 'normal')
    y += PDF_FONTS.BODY * PDF_SPACING.LINE_HEIGHT + 4
  }

  // -----------------------------------------------------------------------
  // Description
  // -----------------------------------------------------------------------

  const description = node.data.description
  if (description && description.trim().length > 0) {
    y = ensureSpace(doc, y, 30)
    y = renderSectionHeader(doc, 'Description', y)
    doc.setFontSize(PDF_FONTS.BODY)
    doc.setTextColor(PDF_COLORS.BLACK)
    doc.setFont('helvetica', 'normal')
    const descLines = doc.splitTextToSize(description, CONTENT_WIDTH)
    doc.text(descLines, MARGIN, y)
    y += descLines.length * PDF_FONTS.BODY * PDF_SPACING.LINE_HEIGHT + 4
  }

  // -----------------------------------------------------------------------
  // Parameter & Resource Tables (skip empty sections)
  // -----------------------------------------------------------------------

  const inputTable = buildInputParamsTable(node.data.inputs, 'step')
  if (inputTable) {
    y = renderLabeledTable(doc, 'Input Parameters', inputTable, y)
  }

  const outputTable = buildOutputParamsTable(node.data.outputs, 'step')
  if (outputTable) {
    y = renderLabeledTable(doc, 'Output Parameters', outputTable, y)
  }

  const resourceTable = buildResourceCommandsTable(node.data.resourceCommands)
  if (resourceTable) {
    y = renderLabeledTable(doc, 'Resource Commands', resourceTable, y)
  }

  // Visual gap between steps
  y += 10

  return y
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Renders all step detail pages into the PDF document.
 * Non-trivial steps each get a full detail section.
 * Control flow steps are grouped compactly at the end.
 *
 * @param doc - jsPDF document instance
 * @param options - Workflow PDF options
 * @returns Y position after all step content
 */
export function renderStepPages(doc: jsPDF, options: WorkflowPDFOptions): number {
  const sorted = topologicalSort(options.nodes, options.edges)

  const nonTrivialNodes: WorkflowNode[] = []
  const controlNodes: WorkflowNode[] = []

  for (const node of sorted) {
    const nodeType = node.type ?? ''
    if (isNonTrivialStep(nodeType)) {
      nonTrivialNodes.push(node)
    } else if (isControlStep(nodeType)) {
      controlNodes.push(node)
    }
  }

  // Add a new page for the steps section if there is content
  if (nonTrivialNodes.length === 0 && controlNodes.length === 0) {
    return MARGIN
  }

  doc.addPage([PDF_PAGE.LETTER_WIDTH, PDF_PAGE.LETTER_HEIGHT], 'portrait')
  let y: number = MARGIN

  // Section heading
  y = renderSectionHeader(doc, 'Step Details', y)

  // Render each non-trivial step
  for (const node of nonTrivialNodes) {
    y = renderStepDetailSection(doc, node, options, y)
  }

  // Render control flow steps as a compact group
  y = renderControlStepGroup(doc, controlNodes, y)

  return y
}
