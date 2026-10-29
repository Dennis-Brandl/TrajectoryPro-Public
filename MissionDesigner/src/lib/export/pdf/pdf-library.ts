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
 * Action Library, Environment Library, and Step Library PDF generators.
 *
 * Produces branded PDF documents with a cover header, TOC page, and
 * dense-packed item sections flowing continuously with horizontal rule
 * dividers. Page breaks occur only on overflow (via ensureSpace).
 *
 * Action and Environment libraries use dense packing with HR dividers.
 * Step Library renders each spec as a full mini-workflow (cover + diagram + steps).
 *
 * LPDF-01: generateActionLibraryPDF — Phase 30: Library PDFs
 * LPDF-02: generateEnvironmentLibraryPDF — Phase 30: Library PDFs
 * LPDF-03: generateStepLibraryPDF — Phase 30: Library PDFs
 */

import { pickLibraryByName } from '@/lib/global-team'
import jsPDF from 'jspdf'
import {
  createPDFDocument,
  addPortraitPage,
  ensureSpace,
  renderItemHeader,
  renderLibraryCoverHeader,
  stampPageFooters,
} from './pdf-export'
import {
  renderLabeledTable,
  buildElementTable,
  buildCoverInputParamsTable,
  buildCoverOutputParamsTable,
  buildCoverValuePropsTable,
  buildCoverResourcesTable,
} from './pdf-tables'
import { renderTableOfContents, type TOCEntry } from './pdf-cover'
import { PDF_FONTS, PDF_SPACING, type WorkflowPDFOptions, type ChildWorkflowSpec } from './pdf-types'
import type { Specification, Library } from '@/types/library'
import type { ParameterSpec, ValueSpec, ResourceSpec, WorkflowNode } from '@/types/nodes'
import type { Edge } from '@xyflow/react'
import { renderChildDiagramPage } from './pdf-diagram'
import { renderStepPages } from './pdf-step-pages'
import { renderAllChildren } from './pdf-children'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * An action's Input and Output Parameters (and any legacy Value Properties), one row per
 * referenceable element. Action parameters are ValueSpecs; dual-format keys are kept for
 * imported data. Empty tables are skipped (dense packing).
 */
function renderActionTables(doc: jsPDF, spec: Specification, y: number): number {
  const inputs = (spec.data.inputs ?? spec.data.inputParameters ?? []) as ValueSpec[]
  const outputs = (spec.data.outputs ?? spec.data.outputParameters ?? []) as ValueSpec[]
  const valueProps = (spec.data.values ?? spec.data.valueProperties ?? []) as ValueSpec[]

  const tables: Array<[string, ValueSpec[]]> = [
    ['Input Parameters', inputs],
    ['Output Parameters', outputs],
    ['Value Properties', valueProps],
  ]
  for (const [label, specs] of tables) {
    const table = buildElementTable(specs)
    // Keep a table's label with its first rows rather than stranding it at a page foot.
    if (table) y = ensureSpace(doc, y, 70)
    y = renderLabeledTable(doc, label, table, y)
  }
  return y
}

// ---------------------------------------------------------------------------
// generateActionLibraryPDF
// ---------------------------------------------------------------------------

/**
 * Generates a PDF document for an Action Library.
 *
 * Contains a branded cover header, a TOC page, and one section per action
 * spec sorted alphabetically. Each section renders Input Parameters, Output
 * Parameters, and Value Properties using the 3-column cover format.
 *
 * Items flow continuously with horizontal rule dividers; page breaks occur
 * only when ensureSpace detects overflow.
 *
 * @param library - The action library metadata
 * @param specifications - Action specs belonging to this library
 * @returns jsPDF document, or null if specifications is empty (caller shows toast warning)
 */
export function generateActionLibraryPDF(library: Library, specifications: Specification[]): jsPDF | null {
  if (specifications.length === 0) return null

  // Sort alphabetically by spec name
  const sorted = [...specifications].sort((a, b) => a.name.localeCompare(b.name))

  // Create document and render cover header on page 1
  const doc = createPDFDocument()
  renderLibraryCoverHeader(doc, {
    name: library.name,
    subtitle: 'Action Library',
    description: library.description ?? undefined,
    date: new Date().toISOString().slice(0, 10),
  })

  // Reserve TOC page (page 2 — filled retroactively after all content)
  addPortraitPage(doc)
  const tocPageNum = doc.getNumberOfPages()

  // Start content on page 3
  addPortraitPage(doc)
  let y: number = PDF_SPACING.PAGE_MARGIN

  const tocEntries: TOCEntry[] = []

  for (const spec of sorted) {
    // Ensure enough room for section header + first table rows
    y = ensureSpace(doc, y, 140)

    // Record TOC entry AFTER ensureSpace (which may have added a new page)
    tocEntries.push({ label: spec.name, pageNum: doc.getNumberOfPages() })

    // Thick rule, then the action's name, version and description
    y = renderItemHeader(doc, spec, y)
    y = renderActionTables(doc, spec, y)
  }

  // Fill TOC page retroactively and stamp footers on all pages
  renderTableOfContents(doc, tocPageNum, tocEntries)
  stampPageFooters(doc, library.name)

  return doc
}

// ---------------------------------------------------------------------------
// generateEnvironmentLibraryPDF
// ---------------------------------------------------------------------------

/**
 * Generates a PDF document for an Environment Library.
 *
 * Contains a branded cover header, a TOC page, and one section per environment
 * spec sorted alphabetically. Each environment section renders:
 * - Included Actions (2-column: Action Name, Action Library)
 * - Value Properties, Action Properties (3-column cover format)
 * - Resources (3-column cover format)
 * - Inline expansion of each included action with its own parameter tables
 *
 * Handles both camelCase (includedActions) and snake_case (included_actions)
 * formats from spec.data, mirroring library-exporters.ts dual-format handling.
 *
 * @param library - The environment library metadata
 * @param specifications - Environment specs belonging to this library
 * @param allLibraries - Optional: all libraries for resolving included action details
 * @param allSpecsByLibrary - Optional: specs keyed by libraryId for action lookup
 * @returns jsPDF document, or null if specifications is empty (caller shows toast warning)
 */
export function generateEnvironmentLibraryPDF(
  library: Library,
  specifications: Specification[],
  allLibraries?: Library[],
  allSpecsByLibrary?: Map<string, Specification[]>,
): jsPDF | null {
  if (specifications.length === 0) return null

  // Sort alphabetically by spec name
  const sorted = [...specifications].sort((a, b) => a.name.localeCompare(b.name))

  // Create document and render cover header on page 1
  const doc = createPDFDocument()
  renderLibraryCoverHeader(doc, {
    name: library.name,
    subtitle: 'Environment Library',
    description: library.description ?? undefined,
    date: new Date().toISOString().slice(0, 10),
  })

  // Reserve TOC page (page 2 — filled retroactively after all content)
  addPortraitPage(doc)
  const tocPageNum = doc.getNumberOfPages()

  // Start content on page 3
  addPortraitPage(doc)
  let y: number = PDF_SPACING.PAGE_MARGIN

  const tocEntries: TOCEntry[] = []

  for (const spec of sorted) {
    // Ensure enough room for section header + first table rows
    y = ensureSpace(doc, y, 140)

    // Record TOC entry AFTER ensureSpace (which may have added a new page)
    tocEntries.push({ label: spec.name, pageNum: doc.getNumberOfPages() })

    // Thick rule, then the environment's name, version and description
    y = renderItemHeader(doc, spec, y)

    // ---------------------------------------------------------------------------
    // Extract spec data — handle dual camelCase/snake_case formats
    // ---------------------------------------------------------------------------

    // Included actions: handle both UI format (included_actions) and import format (includedActions)
    const rawActions = (spec.data.included_actions ?? spec.data.includedActions) as
      | Array<{
          action_name?: string
          action_library?: string
          actionName?: string
          actionLibrary?: string
        }>
      | undefined

    // Value properties
    const valueProps = (spec.data.values ?? spec.data.valueProperties ?? []) as ValueSpec[]

    // Action properties
    const actionProps = (spec.data.actionProperties ?? spec.data.action_properties ?? []) as ValueSpec[]

    // Resources: UI format (resources: ResourceSpec[]) vs import format (resourcePropertySpecs)
    const uiResources = spec.data.resources as
      | Array<{ name: string; resourceType: string; count: number; description?: string }>
      | undefined
    const importResources = (spec.data.resourcePropertySpecs ?? spec.data.resource_property_specifications) as
      | Array<{ name: string; resourceType: string; useLimit?: number; description?: string }>
      | undefined

    const resources: ResourceSpec[] = uiResources
      ? uiResources.map((r) => ({
          id: r.name,
          name: r.name,
          resourceType: r.resourceType as ResourceSpec['resourceType'],
          count: r.count,
          description: r.description,
        }))
      : importResources
        ? importResources.map((r) => ({
            id: r.name,
            name: r.name,
            resourceType: r.resourceType as ResourceSpec['resourceType'],
            count: r.useLimit ?? 1,
            description: r.description,
          }))
        : []

    // ---------------------------------------------------------------------------
    // Render environment's own tables
    // ---------------------------------------------------------------------------

    // Included Actions: 2-column table (Action Name, Action Library)
    if (rawActions && rawActions.length > 0) {
      const actionsTable = {
        head: [['Action Name', 'Action Library']],
        body: rawActions.map((a) => [a.action_name ?? a.actionName ?? '', a.action_library ?? a.actionLibrary ?? '']),
      }
      y = renderLabeledTable(doc, 'Included Actions', actionsTable, y)
    }

    // Value and Action Properties: one row per referenceable element (Prop.Element)
    y = renderLabeledTable(doc, 'Value Properties', buildElementTable(valueProps), y)
    y = renderLabeledTable(doc, 'Action Properties', buildElementTable(actionProps), y)

    // Resources (3-column cover format)
    y = renderLabeledTable(doc, 'Resources', buildCoverResourcesTable(resources), y)

    // ---------------------------------------------------------------------------
    // Inline action expansion — render each included action's parameter tables
    // ---------------------------------------------------------------------------

    if (rawActions && allLibraries && allSpecsByLibrary) {
      for (const action of rawActions) {
        const actionName = action.action_name ?? action.actionName ?? ''
        const actionLibName = action.action_library ?? action.actionLibrary ?? ''

        // Find the action library by name and entityType
        const actionLib = pickLibraryByName(allLibraries, actionLibName, 'action', library.teamId)
        if (!actionLib) continue

        // Find the action spec by name within that library
        const actionSpecs = allSpecsByLibrary.get(actionLib.id) || []
        const actionSpec = actionSpecs.find((s) => s.name === actionName)
        if (!actionSpec) continue

        // Ensure enough space for the action sub-header + first table
        y = ensureSpace(doc, y, 140)

        // Indented sub-header: lighter rule, name, version, description
        y = renderItemHeader(doc, { ...actionSpec, name: `Action: ${actionName}` }, y, { nested: true })
        y = renderActionTables(doc, actionSpec, y)
      }
    }
  }

  // Fill TOC page retroactively and stamp footers on all pages
  renderTableOfContents(doc, tocPageNum, tocEntries)
  stampPageFooters(doc, library.name)

  return doc
}

// ---------------------------------------------------------------------------
// generateStepLibraryPDF
// ---------------------------------------------------------------------------

/**
 * Generates a PDF document for a Step Library.
 *
 * Step specs are full workflows — each gets its own cover section (name,
 * description, property tables), a full-page diagram, step detail pages, and
 * recursive child workflow expansion. Items are sorted alphabetically and each
 * starts on a new page.
 *
 * Unlike Action and Environment libraries which use dense packing, Step Library
 * renders each spec as a complete mini-workflow document section.
 *
 * @param library - The step library metadata
 * @param specifications - Step specs belonging to this library
 * @param allSpecs - Optional map of all known workflow specs for recursive child rendering
 * @returns jsPDF document, or null if specifications is empty (caller shows toast warning)
 */
export function generateStepLibraryPDF(
  library: Library,
  specifications: Specification[],
  allSpecs?: Map<string, ChildWorkflowSpec>,
): jsPDF | null {
  if (specifications.length === 0) return null

  // Sort alphabetically by spec name
  const sorted = [...specifications].sort((a, b) => a.name.localeCompare(b.name))

  // Create document and render library cover header on page 1
  const doc = createPDFDocument()
  renderLibraryCoverHeader(doc, {
    name: library.name,
    subtitle: 'Step Library',
    description: library.description ?? undefined,
    date: new Date().toISOString().slice(0, 10),
  })

  // Reserve TOC page (page 2 — filled retroactively after all content)
  addPortraitPage(doc)
  const tocPageNum = doc.getNumberOfPages()

  const tocEntries: TOCEntry[] = []

  // Build allSpecs map from step specifications (step specs ARE workflows)
  const specMap = allSpecs ?? new Map<string, ChildWorkflowSpec>()
  for (const spec of sorted) {
    const d = spec.data as Record<string, unknown>
    if (d.nodes) {
      specMap.set(spec.id, {
        nodes: (d.nodes ?? []) as WorkflowNode[],
        edges: (d.edges ?? []) as Edge[],
        name: spec.name,
        version: (d.version as string) ?? '',
        oid: (d.oid as string) ?? '',
        description: spec.description ?? '',
        inputParameters: (d.inputParameters ?? []) as ParameterSpec[],
        outputParameters: (d.outputParameters ?? []) as ParameterSpec[],
        valueProperties: (d.valueProperties ?? []) as ValueSpec[],
        resources: (d.resources ?? []) as ResourceSpec[],
        parentSpecId: (d.parentSpecificationId as string) ?? undefined,
      })
    }
  }

  // Render each step spec as a mini workflow
  for (const spec of sorted) {
    // Each step spec starts on its own new page
    addPortraitPage(doc)
    tocEntries.push({ label: spec.name, pageNum: doc.getNumberOfPages() })

    const d = spec.data as Record<string, unknown>
    const nodes = (d.nodes ?? []) as WorkflowNode[]
    const edges = (d.edges ?? []) as Edge[]
    const notation = (d.notation as string) ?? 'flowchart'

    // Render mini-cover header for this step spec
    let y = renderLibraryCoverHeader(doc, {
      name: spec.name,
      titleSize: PDF_FONTS.TITLE,
      subtitle: 'Step Specification',
      description: spec.description ?? undefined,
      date: new Date(spec.updatedAt).toISOString().slice(0, 10),
    })

    // Render property tables on the cover page (same pattern as workflow cover)
    const inputParams = (d.inputParameters ?? []) as ParameterSpec[]
    const outputParams = (d.outputParameters ?? []) as ParameterSpec[]
    const valueProps = (d.valueProperties ?? []) as ValueSpec[]
    const resources = (d.resources ?? []) as ResourceSpec[]

    y = renderLabeledTable(doc, 'Input Parameters', buildCoverInputParamsTable(inputParams), y, {
      showNoneIfEmpty: true,
    })
    y = renderLabeledTable(doc, 'Output Parameters', buildCoverOutputParamsTable(outputParams), y, {
      showNoneIfEmpty: true,
    })
    y = renderLabeledTable(doc, 'Value Properties', buildCoverValuePropsTable(valueProps), y, { showNoneIfEmpty: true })
    y = renderLabeledTable(doc, 'Resources', buildCoverResourcesTable(resources), y, { showNoneIfEmpty: true })

    // Suppress unused variable warning — y used only for side-effect table rendering above
    void y

    // Render diagram page (if nodes exist)
    if (nodes.length > 0) {
      renderChildDiagramPage(doc, nodes, edges, notation as 'flowchart' | 'bpmn' | 'isa88')
    }

    // Render step detail pages (if nodes exist)
    if (nodes.length > 0) {
      const stepOptions: WorkflowPDFOptions = {
        name: spec.name,
        version: (d.version as string) ?? '',
        oid: (d.oid as string) ?? '',
        nodes,
        edges,
        notation: notation as 'flowchart' | 'bpmn' | 'isa88',
        allSpecs: specMap,
      }
      renderStepPages(doc, stepOptions)
    }

    // Render child workflows (full recursion) if this spec has children in specMap
    if (nodes.length > 0 && specMap.size > 0) {
      const visited = new Set<string>([spec.id])
      const { childPageMap } = renderAllChildren(
        doc,
        spec.id,
        {
          name: spec.name,
          version: (d.version as string) ?? '',
          oid: (d.oid as string) ?? '',
          nodes,
          edges,
          notation: notation as 'flowchart' | 'bpmn' | 'isa88',
          allSpecs: specMap,
          rootSpecId: spec.id,
        },
        visited,
      )
      // Add child pages to TOC as indented entries
      for (const [childId, pageNum] of childPageMap) {
        const child = specMap.get(childId)
        if (child) {
          tocEntries.push({ label: `  Child: ${child.name}`, pageNum, indent: 1 })
        }
      }
    }
  }

  // Fill TOC page retroactively and stamp footers on all pages
  renderTableOfContents(doc, tocPageNum, tocEntries)
  stampPageFooters(doc, library.name)

  return doc
}
