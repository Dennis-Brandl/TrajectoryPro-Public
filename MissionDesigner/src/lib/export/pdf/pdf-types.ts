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

import type { Edge } from '@xyflow/react'
import type { WorkflowNode, ParameterSpec, ValueSpec, ResourceSpec } from '@/types/nodes'
import type { Notation } from '@/types/notation'

// ---------------------------------------------------------------------------
// Typography constants (pt) — Section 2 of docs/pdf-export-spec.md
// ---------------------------------------------------------------------------

export const PDF_FONTS = {
  TITLE: 12,
  /** Library name on an action/environment/step library cover. */
  LIBRARY_TITLE: 20,
  /** Each action/environment name in a library PDF. */
  ITEM_TITLE: 16,
  SECTION_HEADER: 12,
  BODY: 10,
  TABLE_CELL: 10,
  TABLE_HEADER: 10,
  STEP_TYPE_LABEL: 8,
  META: 8,
  FOOTER: 8,
  CODE: 8,
  CONTINUATION: 8,
  YOU_ARE_HERE: 6,
} as const

// ---------------------------------------------------------------------------
// Color constants — Section 2 of docs/pdf-export-spec.md
// ---------------------------------------------------------------------------

export const PDF_COLORS = {
  BLACK: '#000000',
  GRAY_DARK: '#666666',
  GRAY_MID: '#999999',
  TABLE_HEADER_BG: '#F0F0F0',
  CODE_BG: '#F5F5F5',
  ORANGE: '#E87A1E',
  ORANGE_FILL: 'rgba(232,122,30,0.35)',
  BORDER_LIGHT: '#CCCCCC',
} as const

// ---------------------------------------------------------------------------
// Spacing constants (pt) — Section 2 of docs/pdf-export-spec.md
// ---------------------------------------------------------------------------

export const PDF_SPACING = {
  LINE_HEIGHT: 1.15,
  SECTION_GAP_BEFORE: 10,
  SECTION_GAP_AFTER: 3,
  TABLE_GAP: 2,
  CELL_PADDING_V: 4,
  CELL_PADDING_H: 6,
  PAGE_MARGIN: 36,
  CELL_BORDER: 0.5,
  DIAGRAM_STRIP_OVERLAP: 0,
} as const

// ---------------------------------------------------------------------------
// Page dimension constants — portrait letter only (no landscape per spec)
// ---------------------------------------------------------------------------

export const PDF_PAGE = {
  LETTER_WIDTH: 612,
  LETTER_HEIGHT: 792,
  get portraitWidth() {
    return this.LETTER_WIDTH - 2 * PDF_SPACING.PAGE_MARGIN
  },
  get portraitHeight() {
    return this.LETTER_HEIGHT - 2 * PDF_SPACING.PAGE_MARGIN
  },
} as const

// ---------------------------------------------------------------------------
// Workflow PDF generation options
// ---------------------------------------------------------------------------

export interface WorkflowPDFOptions {
  /** Workflow specification name */
  name: string
  /** Version string (e.g. "1.0.0") */
  version: string
  /** Workflow OID */
  oid: string
  /** Optional description text */
  description?: string
  /** Optional last-modified date string */
  lastModifiedDate?: string
  /** Workflow nodes */
  nodes: WorkflowNode[]
  /** Workflow edges */
  edges: Edge[]
  /** Input parameter specifications */
  inputParameters?: ParameterSpec[]
  /** Output parameter specifications */
  outputParameters?: ParameterSpec[]
  /** Value property specifications */
  valueProperties?: ValueSpec[]
  /** Resource specifications */
  resources?: ResourceSpec[]
  /** Image data URIs (filename → data URI) */
  images?: Map<string, string>
  /** Active notation for minimap rendering and BPMN slice detection */
  notation?: Notation
  /** Root specification ID for child discovery */
  rootSpecId?: string
  /** All workflow specifications for child discovery and recursive rendering */
  allSpecs?: Map<string, ChildWorkflowSpec>
}

// ---------------------------------------------------------------------------
// Child workflow specification
// ---------------------------------------------------------------------------

/** Child workflow specification data for recursive PDF rendering */
export interface ChildWorkflowSpec {
  nodes: WorkflowNode[]
  edges: Edge[]
  name: string
  version: string
  oid: string
  description: string
  inputParameters: ParameterSpec[]
  outputParameters: ParameterSpec[]
  valueProperties: ValueSpec[]
  resources: ResourceSpec[]
  /** Parent spec ID for child discovery — matches parentSpecificationId in spec.data */
  parentSpecId?: string
}
