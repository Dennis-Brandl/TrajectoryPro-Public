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
import type { WorkflowNode } from './nodes'
import { generateOID, WORKER_WORKFLOW } from '@/lib/snowflake'

/**
 * Current schema version as a literal type.
 * Increment this on breaking changes to trigger compile-time errors
 * where migration logic needs updating.
 */
export type SchemaVersion = 1

/**
 * Workflow document metadata.
 */
export interface WorkflowMetadata {
  /** Unique identifier for this workflow */
  id: string

  /** Human-readable workflow name */
  name: string

  /** ISO 8601 timestamp of creation */
  createdAt: string

  /** ISO 8601 timestamp of last modification */
  updatedAt: string
}

/**
 * Diagram state including nodes, edges, and viewport.
 */
export interface WorkflowDiagram {
  /** All nodes in the workflow */
  nodes: WorkflowNode[]

  /** All edges connecting nodes */
  edges: Edge[]

  /** Current viewport position and zoom level */
  viewport: {
    x: number
    y: number
    zoom: number
  }
}

/**
 * Complete workflow document with versioned schema.
 * The schemaVersion is a literal type (1) to catch migration needs at compile time.
 */
export interface WorkflowDocument {
  /** Schema version - literal type 1, increment on breaking changes */
  schemaVersion: SchemaVersion

  /** Document metadata */
  metadata: WorkflowMetadata

  /** Diagram data (nodes, edges, viewport) */
  diagram: WorkflowDiagram
}

/**
 * Migrate a workflow document from any previous version to the current version.
 * This function will grow as schema versions increase.
 *
 * @param doc - Unknown document data (could be any version or unversioned)
 * @returns WorkflowDocument at current schema version
 * @throws Error if document cannot be migrated
 */
export function migrateWorkflow(doc: unknown): WorkflowDocument {
  // Handle null/undefined
  if (!doc || typeof doc !== 'object') {
    throw new Error('Invalid workflow document: expected an object')
  }

  const docObj = doc as Record<string, unknown>
  const version = typeof docObj.schemaVersion === 'number' ? docObj.schemaVersion : 0

  // Migration chain - each version migrates to the next
  let migrated = docObj

  if (version === 0) {
    // Migrate from unversioned to v1
    migrated = migrateV0toV1(migrated)
  }

  // Future migrations:
  // if (migrated.schemaVersion === 1) { migrated = migrateV1toV2(migrated); }
  // if (migrated.schemaVersion === 2) { migrated = migrateV2toV3(migrated); }

  return migrated as unknown as WorkflowDocument
}

/**
 * Migrate from unversioned (v0) document to v1.
 * Adds schemaVersion and ensures required structure exists.
 */
function migrateV0toV1(doc: Record<string, unknown>): Record<string, unknown> {
  return {
    schemaVersion: 1 as const,
    metadata: doc.metadata ?? {
      id: generateOID(WORKER_WORKFLOW),
      name: 'Untitled Workflow',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    diagram: doc.diagram ?? {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  }
}
