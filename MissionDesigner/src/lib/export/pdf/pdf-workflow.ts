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
 * Workflow PDF orchestrator.
 *
 * Sequences all PDF sections: cover section (header + property tables),
 * table of contents (reserved then filled retroactively), diagram pages,
 * step detail pages, child workflow sections, and page footers.
 *
 * This is the single entry point for generating a complete Workflow PDF.
 * WPDF-01, WPDF-02, WCHILD-01, WCHILD-02 — Phase 29: Workflow Cover, Children & Assembly
 */

import jsPDF from 'jspdf'
import { createPDFDocument, addPortraitPage, stampPageFooters } from './pdf-export'
import { renderDiagramPages } from './pdf-diagram'
import { renderStepPages } from './pdf-step-pages'
import { renderCoverSection, renderTableOfContents, type TOCEntry } from './pdf-cover'
import { renderAllChildren } from './pdf-children'
import type { WorkflowPDFOptions } from './pdf-types'

/**
 * Generates a complete workflow PDF document with all sections.
 *
 * Sections in order:
 * 1. Cover section (branding, name, version, OID, description, property tables)
 * 2. TOC page (reserved blank page — filled retroactively after all content)
 * 3. Diagram pages (React Flow capture, strip/slice splitting)
 * 4. Step detail pages (minimap thumbnails, form grids, script blocks, etc.)
 * 5. Child workflow sections (mini-cover + diagram + steps for each descendant)
 * 6. Table of Contents (filled retroactively on the reserved TOC page)
 * 7. Page footers on all pages
 *
 * @param options - Workflow PDF generation options
 * @returns Fully populated jsPDF document (not yet saved/downloaded)
 */
export async function generateWorkflowPDF(options: WorkflowPDFOptions): Promise<jsPDF> {
  const doc = createPDFDocument()

  // 1. Cover section (header + property tables on page 1, may spill to page 2)
  renderCoverSection(doc, options)

  // 2. Reserve TOC page (blank page between cover and diagram)
  addPortraitPage(doc)
  const tocPageNum = doc.getNumberOfPages()

  // 3. Diagram pages (async — captures React Flow DOM via html-to-image)
  // renderDiagramPages adds its own page as first action — record page count before
  const diagramPageNum = doc.getNumberOfPages() + 1
  await renderDiagramPages(doc, options)

  // 4. Step detail pages
  // renderStepPages adds its own page as first action — record page count before
  const stepsPageNum = doc.getNumberOfPages() + 1
  renderStepPages(doc, options)

  // 5. Child workflow sections
  let childPageMap = new Map<string, number>()
  if (options.allSpecs && options.allSpecs.size > 0 && options.rootSpecId) {
    const visited = new Set<string>([options.rootSpecId])
    const result = renderAllChildren(doc, options.rootSpecId, options, visited)
    childPageMap = result.childPageMap
  }

  // 6. Fill in TOC page retroactively
  const tocEntries: TOCEntry[] = []
  tocEntries.push({ label: 'Workflow Diagram', pageNum: diagramPageNum })
  tocEntries.push({ label: 'Step Details', pageNum: stepsPageNum })

  // Add child entries from childPageMap
  if (options.allSpecs) {
    for (const [childId, pageNum] of childPageMap) {
      const child = options.allSpecs.get(childId)
      if (child) {
        tocEntries.push({ label: `Child: ${child.name}`, pageNum, indent: 1 })
      }
    }
  }

  renderTableOfContents(doc, tocPageNum, tocEntries)

  // 7. Stamp all pages with footers
  stampPageFooters(doc, options.name)

  return doc
}
