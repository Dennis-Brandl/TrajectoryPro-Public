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

import type { Library, Specification } from '@/types/library'
import type { WorkflowNode, StepNodeData } from '@/types/nodes'
import type { ManagedElement } from './export-types'

// =============================================================================
// Entity Converters
// =============================================================================

/**
 * Creates a ManagedElement from a Library.
 */
export function libraryToManagedElement(library: Library): ManagedElement & { parent_library_oid?: string } {
  return {
    local_id: library.name,
    oid: library.id,
    description: library.description ?? undefined,
    version: library.version || '1.0.0',
    last_modified_date: new Date(library.updatedAt).toISOString(),
    ...(library.parentLibraryId ? { parent_library_oid: library.parentLibraryId } : {}),
  }
}

/**
 * Creates a ManagedElement from a Specification.
 */
export function specToManagedElement(spec: Specification): ManagedElement {
  return {
    local_id: spec.name,
    oid: spec.id,
    description: spec.description ?? undefined,
    version: spec.version || '1.0.0',
    last_modified_date: new Date(spec.updatedAt).toISOString(),
  }
}

/**
 * Creates a ManagedElement from a WorkflowNode.
 */
export function nodeToManagedElement(node: WorkflowNode): ManagedElement {
  const data = node.data as StepNodeData
  return {
    local_id: data.label,
    oid: node.id,
    description: data.description,
    version: '1.0.0',
    last_modified_date: new Date().toISOString(),
  }
}
