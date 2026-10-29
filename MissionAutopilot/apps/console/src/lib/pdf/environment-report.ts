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

// IMPORTANT: This module is the lazy boundary for `jspdf`. Always reach it
// via `await import('@/lib/pdf/environment-report')` from app code (see
// `useGenerateEnvironmentReport`). A static import from the main bundle
// path would ship jspdf (~150 KB) in the initial chunk.

import { jsPDF } from 'jspdf'
import type { EnvirBundle, BundleAction, BundleParameterSpec } from '../envir-bundle'

const PAGE_MARGIN = 15 // mm
const LINE_HEIGHT_BODY = 5
const LINE_HEIGHT_CODE = 3.5
const PAGE_W = 210 // A4 mm
const PAGE_H = 297
const CONTENT_W = PAGE_W - PAGE_MARGIN * 2
const PAGE_BREAK_THRESHOLD = 80 // mm — start a new page if less remains

export function generateEnvironmentReportPDF(bundle: EnvirBundle): Blob {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const generatedAt = new Date().toLocaleString()

  let y = renderCover(pdf, bundle)
  y = ensureNewPage(pdf, y)

  for (const action of bundle.actions) {
    y = renderAction(pdf, y, action)
  }

  renderHeadersAndFooters(pdf, bundle, generatedAt)

  const arrayBuffer = pdf.output('arraybuffer')
  return new Blob([arrayBuffer], { type: 'application/pdf' })
}

function renderCover(pdf: jsPDF, bundle: EnvirBundle): number {
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(18)
  pdf.text(bundle.environment.local_id, PAGE_MARGIN, PAGE_MARGIN + 6)

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  const dateStr = bundle.environment.last_modified_date ?? bundle.manifest.exported_at
  pdf.text(
    `v${bundle.environment.version} · imported ${formatDate(dateStr)} · ${bundle.actions.length} actions`,
    PAGE_MARGIN,
    PAGE_MARGIN + 13
  )

  let y = PAGE_MARGIN + 22
  if (bundle.environment.description) {
    const lines = pdf.splitTextToSize(bundle.environment.description, CONTENT_W) as string[]
    for (const line of lines) {
      pdf.text(line, PAGE_MARGIN, y)
      y += LINE_HEIGHT_BODY
    }
    y += 2
  }

  // Environment action properties table
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(12)
  pdf.text('Environment action properties', PAGE_MARGIN, y)
  y += 6
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  if (bundle.environment.action_property_specifications.length === 0) {
    pdf.text('(none)', PAGE_MARGIN, y)
    y += LINE_HEIGHT_BODY
  } else {
    y = renderParamTable(pdf, y, bundle.environment.action_property_specifications, [
      'name',
      'data_type',
      'default',
    ])
  }
  y += 4

  // Actions overview
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(12)
  pdf.text(`Actions (${bundle.actions.length})`, PAGE_MARGIN, y)
  y += 6
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  for (let i = 0; i < bundle.actions.length; i++) {
    const a = bundle.actions[i]!
    pdf.text(`${i + 1}. ${a.record.local_id}`, PAGE_MARGIN, y)
    pdf.text(a.record.action_visibility, PAGE_MARGIN + 70, y)
    y += LINE_HEIGHT_BODY
    if (y > PAGE_H - PAGE_MARGIN - 10) {
      pdf.addPage()
      y = PAGE_MARGIN
    }
  }
  return y
}

function renderAction(
  pdf: jsPDF,
  yIn: number,
  action: { record: BundleAction; code: Record<string, string> }
): number {
  let y = yIn
  if (y > PAGE_H - PAGE_MARGIN - PAGE_BREAK_THRESHOLD) {
    pdf.addPage()
    y = PAGE_MARGIN
  }

  // Header line: name + visibility
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(12)
  pdf.text(action.record.local_id, PAGE_MARGIN, y)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  pdf.text(action.record.action_visibility, PAGE_W - PAGE_MARGIN, y, { align: 'right' })
  y += 6

  // Description
  if (action.record.description) {
    const lines = pdf.splitTextToSize(action.record.description, CONTENT_W) as string[]
    for (const line of lines) {
      pdf.text(line, PAGE_MARGIN, y)
      y += LINE_HEIGHT_BODY
    }
    y += 2
  }

  // Input params
  pdf.setFont('helvetica', 'bold')
  pdf.text('Input parameters', PAGE_MARGIN, y)
  y += 5
  pdf.setFont('helvetica', 'normal')
  if (action.record.input_parameter_specifications.length === 0) {
    pdf.text('(no input parameters)', PAGE_MARGIN, y)
    y += LINE_HEIGHT_BODY
  } else {
    y = renderParamTable(pdf, y, action.record.input_parameter_specifications, [
      'name',
      'description',
      'default',
    ])
  }
  y += 3

  // Output params
  pdf.setFont('helvetica', 'bold')
  pdf.text('Output parameters', PAGE_MARGIN, y)
  y += 5
  pdf.setFont('helvetica', 'normal')
  if (action.record.output_parameter_specifications.length === 0) {
    pdf.text('(no output parameters)', PAGE_MARGIN, y)
    y += LINE_HEIGHT_BODY
  } else {
    y = renderParamTable(pdf, y, action.record.output_parameter_specifications, [
      'name',
      'description',
    ])
  }
  y += 3

  // Code segments
  pdf.setFont('helvetica', 'bold')
  const states = Object.keys(action.code)
  pdf.text(
    `Code segments (${states.length} state${states.length === 1 ? '' : 's'} with code)`,
    PAGE_MARGIN,
    y
  )
  y += 5
  pdf.setFont('helvetica', 'normal')
  if (states.length === 0) {
    pdf.text('(no code segments authored)', PAGE_MARGIN, y)
    y += LINE_HEIGHT_BODY
  } else {
    for (const state of states) {
      y = renderCodeBlock(pdf, y, action.record.local_id, state, action.code[state]!)
      y += 2
    }
  }
  y += 5
  return y
}

function renderParamTable(
  pdf: jsPDF,
  yIn: number,
  rows: BundleParameterSpec[],
  columns: string[]
): number {
  let y = yIn
  const colW = columns.length === 3 ? [50, 80, 50] : [60, 120]
  const startX = PAGE_MARGIN

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  for (let i = 0; i < columns.length; i++) {
    pdf.text(columns[i]!, startX + sum(colW.slice(0, i)), y)
  }
  y += 4
  pdf.setDrawColor(180)
  pdf.setLineWidth(0.2)
  pdf.line(startX, y - 2, startX + sum(colW), y - 2)

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  for (const row of rows) {
    const cells = columns.map((c) => {
      if (c === 'name') return row.id
      if (c === 'data_type' || c === 'value_type') return row.value_type
      if (c === 'default') return row.default_value
      if (c === 'description') return row.description ?? ''
      return ''
    })
    const wrapped = cells.map((text, i) => pdf.splitTextToSize(text, colW[i]! - 2) as string[])
    const maxLines = Math.max(...wrapped.map((w) => w.length))
    for (let line = 0; line < maxLines; line++) {
      for (let col = 0; col < columns.length; col++) {
        const lineText = wrapped[col]![line] ?? ''
        pdf.text(lineText, startX + sum(colW.slice(0, col)), y)
      }
      y += 4
      if (y > PAGE_H - PAGE_MARGIN - 10) {
        pdf.addPage()
        y = PAGE_MARGIN
      }
    }
    pdf.line(startX, y - 2, startX + sum(colW), y - 2)
  }
  pdf.setFontSize(10)
  return y + 2
}

function renderCodeBlock(
  pdf: jsPDF,
  yIn: number,
  actionLocalId: string,
  state: string,
  source: string
): number {
  let y = yIn

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(10)
  pdf.text(`▸ ${state}`, PAGE_MARGIN, y)
  y += LINE_HEIGHT_BODY

  pdf.setFont('courier', 'normal')
  pdf.setFontSize(8)
  const lines = source.split('\n')
  for (const line of lines) {
    const wrapped = pdf.splitTextToSize(line.length === 0 ? ' ' : line, CONTENT_W) as string[]
    for (const wline of wrapped) {
      if (y > PAGE_H - PAGE_MARGIN - 10) {
        pdf.addPage()
        y = PAGE_MARGIN
        pdf.setFont('helvetica', 'italic')
        pdf.setFontSize(8)
        pdf.text(`${actionLocalId} › ${state} (continued)`, PAGE_MARGIN, y)
        y += LINE_HEIGHT_BODY
        pdf.setFont('courier', 'normal')
        pdf.setFontSize(8)
      }
      pdf.text(wline, PAGE_MARGIN, y)
      y += LINE_HEIGHT_CODE
    }
  }
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  return y
}

function renderHeadersAndFooters(pdf: jsPDF, bundle: EnvirBundle, generatedAt: string): void {
  const total = pdf.getNumberOfPages()
  for (let i = 1; i <= total; i++) {
    pdf.setPage(i)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.setTextColor(140)
    if (i > 1) {
      pdf.text(
        `${bundle.environment.local_id} · v${bundle.environment.version} · page ${i} of ${total}`,
        PAGE_MARGIN,
        8
      )
    }
    pdf.text(`Generated ${generatedAt}`, PAGE_MARGIN, PAGE_H - 6)
    pdf.setTextColor(0)
  }
}

function ensureNewPage(pdf: jsPDF, y: number): number {
  if (y > PAGE_H - PAGE_MARGIN - PAGE_BREAK_THRESHOLD) {
    pdf.addPage()
    return PAGE_MARGIN
  }
  return y
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
  } catch {
    return iso
  }
}

function sum(arr: number[]): number {
  let s = 0
  for (const n of arr) s += n
  return s
}
