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
 * Child workflow discovery and recursive rendering for the Workflow PDF.
 *
 * Discovers all descendant workflow specifications via BFS traversal of
 * parentSpecId linkages, then renders each child as a mini-cover section
 * followed by diagram and step detail pages.
 *
 * WCHILD-01, WCHILD-02 — Phase 29: Workflow Cover, Children & Assembly
 */

import type jsPDF from 'jspdf'
import { addPortraitPage, ensureSpace } from './pdf-export'
import {
  renderLabeledTable,
  buildCoverInputParamsTable,
  buildCoverOutputParamsTable,
  buildCoverValuePropsTable,
  buildCoverResourcesTable,
} from './pdf-tables'
import { renderChildDiagramPage } from './pdf-diagram'
import { renderStepPages } from './pdf-step-pages'
import { PDF_FONTS, PDF_SPACING, PDF_COLORS, type WorkflowPDFOptions, type ChildWorkflowSpec } from './pdf-types'

// ---------------------------------------------------------------------------
// Child discovery
// ---------------------------------------------------------------------------

/**
 * Discovers all descendant workflow specifications in BFS order via parentSpecId linkage.
 *
 * Uses a queue-based BFS traversal to find children, grandchildren, and all
 * deeper descendants. The visited set prevents infinite loops from circular
 * parentSpecId references.
 *
 * @param rootSpecId - Spec ID to find children of (starting point)
 * @param allSpecs - Map of all known workflow specifications
 * @param visited - Set of already-visited spec IDs (mutated in place — caller should pre-add root)
 * @returns Object containing ordered flat BFS list and skipped (circular/duplicate) specs
 */
export function collectChildrenInOrder(
  rootSpecId: string,
  allSpecs: Map<string, ChildWorkflowSpec>,
  visited: Set<string>,
): { ordered: string[]; skipped: Array<{ id: string; name: string }> } {
  const result: string[] = []
  const skipped: Array<{ id: string; name: string }> = []
  const queue: string[] = [rootSpecId]

  while (queue.length > 0) {
    const parentId = queue.shift()!

    // Find direct children of this parent
    for (const [id, spec] of allSpecs) {
      if (spec.parentSpecId !== parentId) continue

      if (visited.has(id)) {
        // Circular or duplicate reference — record for inline note
        skipped.push({ id, name: spec.name })
      } else {
        result.push(id)
        visited.add(id)
        queue.push(id)
      }
    }
  }

  return { ordered: result, skipped }
}

// ---------------------------------------------------------------------------
// Child rendering
// ---------------------------------------------------------------------------

/**
 * Renders all descendant workflow sections in BFS order.
 *
 * For each child: adds a new page with a mini-cover header, four property
 * tables, a diagram page, and step detail pages. Circular/duplicate
 * references are rendered as inline italic notes.
 *
 * @param doc - jsPDF document instance
 * @param parentSpecId - Root spec ID to discover children from
 * @param options - WorkflowPDFOptions (must include allSpecs and notation)
 * @param visited - Set of already-rendered spec IDs (root should already be in this set)
 * @returns Map of specId to starting page number for TOC construction
 */
export function renderAllChildren(
  doc: jsPDF,
  parentSpecId: string,
  options: WorkflowPDFOptions,
  visited: Set<string>,
): { childPageMap: Map<string, number> } {
  const childPageMap = new Map<string, number>()

  if (!options.allSpecs || options.allSpecs.size === 0) {
    return { childPageMap }
  }

  const { ordered, skipped } = collectChildrenInOrder(parentSpecId, options.allSpecs, visited)

  if (ordered.length === 0 && skipped.length === 0) {
    return { childPageMap }
  }

  const margin = PDF_SPACING.PAGE_MARGIN
  const pageWidth = doc.internal.pageSize.getWidth() - 2 * margin

  // Render each child in BFS order
  for (const childId of ordered) {
    const child = options.allSpecs.get(childId)!

    // -----------------------------------------------------------------------
    // Mini-cover page
    // -----------------------------------------------------------------------
    addPortraitPage(doc)
    const childPageNum = doc.getNumberOfPages()
    childPageMap.set(childId, childPageNum)

    let y: number = margin

    // Mini-cover header: bold 12pt "Child: Name (OID vVersion)"
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(PDF_COLORS.BLACK)
    const headerText = `Child: ${child.name} (${child.oid} v${child.version})`
    doc.text(headerText, margin, y)
    y += 12 * PDF_SPACING.LINE_HEIGHT + 4

    // Description (if exists)
    if (child.description && child.description.trim().length > 0) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(PDF_FONTS.BODY)
      doc.setTextColor(PDF_COLORS.BLACK)
      const descLines = doc.splitTextToSize(child.description, pageWidth)
      doc.text(descLines, margin, y)
      y += descLines.length * PDF_FONTS.BODY * PDF_SPACING.LINE_HEIGHT + 6
    }

    // Four property tables with showNoneIfEmpty
    y = renderLabeledTable(doc, 'Input Parameters', buildCoverInputParamsTable(child.inputParameters), y, {
      showNoneIfEmpty: true,
    })
    y = renderLabeledTable(doc, 'Output Parameters', buildCoverOutputParamsTable(child.outputParameters), y, {
      showNoneIfEmpty: true,
    })
    y = renderLabeledTable(doc, 'Value Properties', buildCoverValuePropsTable(child.valueProperties), y, {
      showNoneIfEmpty: true,
    })
    renderLabeledTable(doc, 'Resources', buildCoverResourcesTable(child.resources), y, {
      showNoneIfEmpty: true,
    })

    // -----------------------------------------------------------------------
    // Diagram page
    // -----------------------------------------------------------------------
    renderChildDiagramPage(doc, child.nodes, child.edges, options.notation ?? 'flowchart')

    // -----------------------------------------------------------------------
    // Step detail pages
    // -----------------------------------------------------------------------
    const childOptions: WorkflowPDFOptions = {
      name: child.name,
      version: child.version,
      oid: child.oid,
      nodes: child.nodes,
      edges: child.edges,
      notation: options.notation,
      images: options.images,
      allSpecs: options.allSpecs,
    }
    renderStepPages(doc, childOptions)
  }

  // -----------------------------------------------------------------------
  // Circular / duplicate reference notes
  // -----------------------------------------------------------------------
  if (skipped.length > 0) {
    addPortraitPage(doc)
    let noteY: number = PDF_SPACING.PAGE_MARGIN

    for (const skip of skipped) {
      const existingPage = childPageMap.get(skip.id) ?? '?'
      noteY = ensureSpace(doc, noteY, PDF_FONTS.BODY + 4)
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(PDF_FONTS.BODY)
      doc.setTextColor(PDF_COLORS.GRAY_DARK)
      doc.text(
        `Circular reference: ${skip.name} already rendered on page ${existingPage} — skipped`,
        PDF_SPACING.PAGE_MARGIN,
        noteY,
      )
      noteY += PDF_FONTS.BODY + 4
    }
  }

  return { childPageMap }
}
