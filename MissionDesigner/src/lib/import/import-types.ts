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
import type { Library, Specification } from '@/types/library'
import type { WorkflowNode, ParameterSpec, ValueSpec, ResourceSpec, TrySpec, ValueTypeSpec } from '@/types/nodes'
import type { ConditionalEdgeData } from '@/types/edges'
import type { MasterWorkflowSpecification } from '@/lib/packageFormat/export-types'

/**
 * Successful import result for a library.
 */
/**
 * An imported spec ready for creation. `id`, when present, is the source spec
 * OID to PRESERVE on create — Actions and Environments must keep their OIDs so a
 * workflow's action-proxy references still resolve after import. Absent → a
 * fresh id is generated at creation time.
 */
export type ImportedSpecification = Omit<Specification, 'id' | 'libraryId'> & { id?: string }

export interface LibraryImportSuccess {
  library: Omit<Library, 'id' | 'userId'>
  specifications: ImportedSpecification[]
  childLibraries?: LibraryImportSuccess[]
}

/**
 * Pending environment spec extracted during import.
 * Uses internal camelCase format for data fields.
 */
export interface PendingEnvironmentSpec {
  name: string
  description: string | null
  libraryName?: string
  version?: string
  includedActions: Array<{
    actionName: string
    actionLibrary: string
  }>
  values: ValueSpec[]
  actionProperties: ValueSpec[]
  valueTypes: ValueTypeSpec[]
  resources: Array<{
    id: string
    name: string
    description?: string
    resourceType: string
    count: number
  }>
  actionServers: Array<{
    id: string
    name: string
    uri: string
    description?: string
    connectionType: string
    apiKey?: string
  }>
}

/**
 * Pending child workflow extracted during import.
 * Same shape as Omit<Specification, 'id' | 'libraryId'>.
 */
export interface PendingChildWorkflow {
  name: string
  description: string | null
  typeName?: string | null
  data: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

/**
 * Successful import result for a workflow.
 */
export interface WorkflowImportSuccess {
  nodes: WorkflowNode[]
  edges: Edge<ConditionalEdgeData>[]
  pendingEnvironmentSpecs?: PendingEnvironmentSpec[]
  pendingChildWorkflows?: PendingChildWorkflow[]
  /** Workflow-level properties extracted from the spec */
  workflowInputs?: ParameterSpec[]
  workflowOutputs?: ParameterSpec[]
  workflowValues?: ValueSpec[]
  workflowResources?: ResourceSpec[]
  /** Workflow-level TRY fallback rows (spec 2026-08-22) */
  workflowTrySpecifications?: TrySpec[]
  viewport?: { x: number; y: number; zoom: number }
  /** Images extracted from ZIP import (filename → data URI) */
  images?: Record<string, string>
  /**
   * Step-config fields dropped at the zod import boundary (audit item 3) —
   * e.g. a malformed script_config or action_proxy_config. Present only when
   * something was dropped; the import itself still succeeds.
   */
  warnings?: string[]
}

/**
 * Failed import result.
 */
export interface ImportError {
  error: string
}

// =============================================================================
// Phase 34: OID Remapping and Package Parsing Types
// =============================================================================

/** A child workflow flattened from the nested export tree, ready for server insertion. */
export interface FlattenedChild {
  /** Original exported OID (before remap) — used to track old->new for proxy backfill */
  originalOid: string
  /** Remapped OID (client-side, not the server-assigned ID) */
  remappedOid: string
  name: string
  description: string | null
  typeName?: string | null
  /** Original parentChildSpecId from export (null = direct child of root) */
  originalParentChildSpecId: string | null
  /** Remapped parentChildSpecId (points to remapped parent OID) */
  remappedParentChildSpecId: string | null
  version: string
  state: string
  data: Record<string, unknown>
}

/** Result of parsing and normalizing a workflow package JSON. */
export interface ParsedWorkflowPackage {
  /** Root workflow spec with fresh OIDs applied */
  rootSpec: MasterWorkflowSpecification
  /** All children flattened (DFS pre-order) with fresh OIDs */
  flatChildren: FlattenedChild[]
  /** Images extracted from ZIP (filename -> data URI) — keys remapped for new OIDs */
  images: Record<string, string>
}

/** Context for OID remapping — maps old IDs to new Snowflake OIDs. */
export interface OidRemapContext {
  /** Maps old OID/ID -> new OID for steps, connections, form elements, children */
  idMap: Map<string, string>
  /** Maps old image key (with OID prefix) -> new image key */
  imageKeyMap: Map<string, string>
}
