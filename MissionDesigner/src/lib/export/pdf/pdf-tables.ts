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

import autoTable from 'jspdf-autotable'
import type jsPDF from 'jspdf'
import type { ParameterSpec, ValueSpec, ResourceSpec, StepResourceCommand } from '@/types/nodes'
import { PDF_COLORS, PDF_FONTS, PDF_SPACING, PDF_PAGE } from './pdf-types'
import { renderSectionHeader } from './pdf-export'

// ---------------------------------------------------------------------------
// Table data type
// ---------------------------------------------------------------------------

/** A body cell: plain text, or text that spans several rows (jspdf-autotable cell def). */
export type TableCell = string | { content: string; rowSpan: number }

export interface TableData {
  head: string[][]
  body: TableCell[][]
  /** Fixed widths (pt) by column index; unset columns size to content. */
  columnWidths?: Record<number, number>
}

// ---------------------------------------------------------------------------
// Pure table data builders (no jsPDF dependency)
// ---------------------------------------------------------------------------

/**
 * Builds input parameters table data.
 * Columns vary by level:
 * - workflow: Name, Description, Default Value
 * - step: Name, Description, Value / Source
 * - action: Name, Entries, Description
 *
 * @returns null if params is empty/undefined
 */
export function buildInputParamsTable(
  params: ParameterSpec[] | undefined,
  level: 'workflow' | 'step' | 'action',
): TableData | null {
  if (!params || params.length === 0) return null

  if (level === 'workflow') {
    return {
      head: [['Name', 'Description', 'Default Value']],
      body: params.map((p) => [p.name, p.description ?? '', p.value ?? '']),
    }
  }

  if (level === 'step') {
    return {
      head: [['Name', 'Description', 'Value / Source']],
      body: params.map((p) => [
        p.name,
        p.description ?? '',
        p.value ? `${p.valueType === 'property' ? '→ ' : ''}${p.value}` : '',
      ]),
    }
  }

  // action level
  return {
    head: [['Name', 'Entries', 'Description']],
    body: params.map((p) => [p.name, p.entries ? p.entries.map((e) => e.name).join(', ') : '', p.description ?? '']),
  }
}

/**
 * Builds output parameters table data.
 * Columns vary by level:
 * - workflow: Name, Description, Target Property
 * - step: Name, Description, Target Property
 *
 * @returns null if params is empty/undefined
 */
export function buildOutputParamsTable(
  params: ParameterSpec[] | undefined,
  _level: 'workflow' | 'step',
): TableData | null {
  if (!params || params.length === 0) return null

  return {
    head: [['Name', 'Description', 'Target Property']],
    body: params.map((p) => [p.name, p.description ?? '', p.target ?? '']),
  }
}

/**
 * Builds value properties table data.
 * Columns: Name, Entries
 *
 * @returns null if values is empty/undefined
 */
export function buildValuePropertiesTable(values: ValueSpec[] | undefined): TableData | null {
  if (!values || values.length === 0) return null

  return {
    head: [['Name', 'Entries']],
    body: values.map((v) => [v.name, v.entries ? v.entries.map((e) => `${e.name}: ${e.value}`).join('; ') : '']),
  }
}

/**
 * Builds resources table data.
 * Columns: Name, Type, Count/Limit, Names
 *
 * @returns null if resources is empty/undefined
 */
export function buildResourcesTable(resources: ResourceSpec[] | undefined): TableData | null {
  if (!resources || resources.length === 0) return null

  return {
    head: [['Name', 'Type', 'Count/Limit', 'Names']],
    body: resources.map((r) => [r.name, r.resourceType, String(r.count), r.names ? r.names.join(', ') : '']),
  }
}

/**
 * Builds resources table data for the cover page with 3-column format.
 * Columns: Name, Type, Description
 *
 * This is distinct from the 4-column buildResourcesTable used for step-level resources.
 * Per Phase 29 context decision: all cover property tables use Name + Type + Description columns.
 *
 * @returns null if resources is empty/undefined
 */
export function buildCoverResourcesTable(resources: ResourceSpec[] | undefined): TableData | null {
  if (!resources || resources.length === 0) return null

  return {
    head: [['Name', 'Type', 'Description']],
    body: resources.map((r) => [r.name, r.resourceType, r.description ?? '']),
  }
}

/**
 * Builds input parameters table data for the cover page with 3-column format.
 * Columns: Name, Type, Description
 *
 * @returns null if params is empty/undefined
 */
export function buildCoverInputParamsTable(params: ParameterSpec[] | undefined): TableData | null {
  if (!params || params.length === 0) return null

  return {
    head: [['Name', 'Type', 'Description']],
    // Type column shows the value type classification (literal|property)
    body: params.map((p) => [p.name, p.valueType ?? 'literal', p.description ?? '']),
  }
}

/**
 * Builds output parameters table data for the cover page with 3-column format.
 * Columns: Name, Type, Description
 *
 * @returns null if params is empty/undefined
 */
export function buildCoverOutputParamsTable(params: ParameterSpec[] | undefined): TableData | null {
  if (!params || params.length === 0) return null

  return {
    head: [['Name', 'Type', 'Description']],
    // Type column shows the value type classification (literal|property)
    body: params.map((p) => [p.name, p.valueType ?? 'literal', p.description ?? '']),
  }
}

/**
 * Builds value properties table data for the cover page with 3-column format.
 * Columns: Name, Type, Description
 *
 * Type shows the entry count; Description lists the entry names.
 *
 * @returns null if values is empty/undefined
 */
export function buildCoverValuePropsTable(values: ValueSpec[] | undefined): TableData | null {
  if (!values || values.length === 0) return null

  return {
    head: [['Name', 'Type', 'Description']],
    body: values.map((v) => [
      v.name,
      `${v.entries?.length ?? 0} entries`,
      v.entries ? v.entries.map((e) => e.name).join(', ') : '',
    ]),
  }
}

/**
 * Builds an action/environment parameter or property table: Name, Description.
 *
 * These are ValueSpecs: the "Description" entry is the description and every other
 * entry is an element a workflow references as `Parameter.Element`. One element is
 * appended to the name; several get a row each, with the description spanning them.
 * No Type column — every action parameter is a literal.
 *
 * @returns null if specs is empty/undefined
 */
export function buildElementTable(specs: ValueSpec[] | undefined): TableData | null {
  if (!specs || specs.length === 0) return null

  const body: TableCell[][] = []
  for (const spec of specs) {
    // Legacy flat parameters carry `description` directly and have no entries.
    const legacy = spec as ValueSpec & { description?: string }
    const entries = spec.entries ?? []
    const description = entries.find((e) => e.name === 'Description')?.value ?? legacy.description ?? ''
    const elements = entries.filter((e) => e.name !== 'Description')

    if (elements.length <= 1) {
      body.push([elements.length ? `${spec.name}.${elements[0].name}` : spec.name, description])
      continue
    }
    elements.forEach((e, i) => {
      const name = `${spec.name}.${e.name}`
      body.push(i === 0 ? [name, { content: description, rowSpan: elements.length }] : [name])
    })
  }
  // A fixed Name column keeps every action's tables aligned down the page.
  return { head: [['Name', 'Description']], body, columnWidths: { 0: 180 } }
}

/**
 * Builds resource commands table data.
 * Columns: Command Type, Resource Name, Count, Target/Source
 *
 * @returns null if commands is empty/undefined
 */
export function buildResourceCommandsTable(commands: StepResourceCommand[] | undefined): TableData | null {
  if (!commands || commands.length === 0) return null

  return {
    head: [['Command Type', 'Resource Name', 'Count', 'Target/Source']],
    body: commands.map((c) => [c.commandType, c.resourceName, String(c.count), c.target ?? c.source ?? '']),
  }
}

// ---------------------------------------------------------------------------
// Renderer functions
// ---------------------------------------------------------------------------

/**
 * Renders a table using jspdf-autotable with grid theme and PDF constant styling.
 *
 * @param doc - jsPDF document
 * @param tableData - Table head and body data
 * @param startY - Starting Y position
 * @param pageWidth - Optional override for table width (defaults to portrait width)
 * @returns Final Y position after the table
 */
export function renderTable(doc: jsPDF, tableData: TableData, startY: number, pageWidth?: number): number {
  const tableWidth = pageWidth ?? PDF_PAGE.portraitWidth
  const margin = PDF_SPACING.PAGE_MARGIN

  autoTable(doc, {
    head: tableData.head,
    body: tableData.body,
    startY,
    theme: 'grid',
    tableWidth,
    margin: { left: margin, right: margin },
    columnStyles: Object.fromEntries(
      Object.entries(tableData.columnWidths ?? {}).map(([i, cellWidth]) => [i, { cellWidth }]),
    ),
    styles: {
      fontSize: PDF_FONTS.TABLE_CELL,
      cellPadding: {
        top: PDF_SPACING.CELL_PADDING_V,
        bottom: PDF_SPACING.CELL_PADDING_V,
        left: PDF_SPACING.CELL_PADDING_H,
        right: PDF_SPACING.CELL_PADDING_H,
      },
      lineWidth: PDF_SPACING.CELL_BORDER,
      lineColor: PDF_COLORS.BORDER_LIGHT,
      textColor: PDF_COLORS.BLACK,
    },
    headStyles: {
      fontSize: PDF_FONTS.TABLE_HEADER,
      fontStyle: 'bold',
      fillColor: PDF_COLORS.TABLE_HEADER_BG,
      textColor: PDF_COLORS.BLACK,
      lineWidth: PDF_SPACING.CELL_BORDER,
      lineColor: PDF_COLORS.BORDER_LIGHT,
    },

    didDrawPage: (data: any) => {
      // Ensure new pages added by autotable use the correct format
      void data
    },
  })

  return (doc as any).lastAutoTable?.finalY ?? startY + 20
}

/**
 * Renders a labeled section header followed by a table.
 * If tableData is null:
 * - showNoneIfEmpty=true: renders the header and "None" text
 * - showNoneIfEmpty=false/undefined: returns startY unchanged (skips entirely)
 *
 * @param doc - jsPDF document
 * @param label - Section header label
 * @param tableData - Table data, or null for empty
 * @param startY - Starting Y position
 * @param options - Options including showNoneIfEmpty flag
 * @returns Final Y position after all rendered content
 */
export function renderLabeledTable(
  doc: jsPDF,
  label: string,
  tableData: TableData | null,
  startY: number,
  options?: { showNoneIfEmpty?: boolean },
): number {
  if (tableData === null) {
    if (options?.showNoneIfEmpty) {
      let y = startY + PDF_SPACING.SECTION_GAP_BEFORE
      y = renderSectionHeader(doc, label, y)
      doc.setFontSize(PDF_FONTS.BODY)
      doc.setTextColor(PDF_COLORS.GRAY_DARK)
      doc.setFont('helvetica', 'normal')
      doc.text('None', PDF_SPACING.PAGE_MARGIN, y)
      y += PDF_FONTS.BODY * PDF_SPACING.LINE_HEIGHT + PDF_SPACING.SECTION_GAP_AFTER
      return y
    }
    // Skip entirely
    return startY
  }

  let y = startY + PDF_SPACING.SECTION_GAP_BEFORE
  y = renderSectionHeader(doc, label, y)
  y += PDF_SPACING.TABLE_GAP
  y = renderTable(doc, tableData, y)
  y += PDF_SPACING.SECTION_GAP_AFTER
  return y
}
