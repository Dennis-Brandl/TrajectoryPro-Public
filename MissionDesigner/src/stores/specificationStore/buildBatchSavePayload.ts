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

// Phase 35 §3.9: build a BatchSaveRequest from the current store state.
// Takes a SINGLE getState() snapshot (§3.13 i9) — never via selector hooks,
// never inside a React render. The payload is deterministic across a single
// snapshot: calling it twice on unchanged state produces identical output.
//
// Excludes specs still in pendingCreationIds (§3.13 i6).

import { useSpecificationStore } from '../specificationStore'

export interface BatchSavePayload {
  specs: Array<Record<string, unknown>>
  proxyRefs: Array<Record<string, unknown>>
  specEnvs: Array<Record<string, unknown>>
  imageDeletes: Array<Record<string, unknown>>
  imageRefs: Array<Record<string, unknown>>
}

export function buildBatchSavePayload(): BatchSavePayload {
  const state = useSpecificationStore.getState() // single snapshot
  const specs: Array<Record<string, unknown>> = []
  const imageDeletes: Array<Record<string, unknown>> = []
  const imageRefs: Array<Record<string, unknown>> = []

  for (const id of state.dirtyIds) {
    if (state.pendingCreationIds.has(id)) continue
    const spec = state.specs.get(id)
    if (!spec) continue
    if (state.unsavedNewIds.has(spec.id)) {
      specs.push({
        op: 'create',
        id: spec.id,
        parentSpecificationId: spec.parentSpecificationId,
        rootSpecificationId: spec.rootSpecificationId,
        libraryId: spec.libraryId,
        name: spec.name,
        description: spec.description,
        typeName: spec.typeName,
        data: JSON.stringify(spec.data),
        dataSchemaVersion: spec.dataSchemaVersion,
        version: spec.version,
        state: spec.state,
      })
    } else {
      specs.push({
        op: 'update',
        id: spec.id,
        name: spec.name,
        description: spec.description,
        typeName: spec.typeName,
        data: JSON.stringify(spec.data),
        dataSchemaVersion: spec.dataSchemaVersion,
        version: spec.version,
        state: spec.state,
      })
    }
  }

  for (const id of state.pendingDeletes) {
    const spec = state.specs.get(id)
    if (!spec) continue
    specs.push({ op: 'delete', id: spec.id })
  }

  for (const op of state.pendingImageOps) {
    if (op.kind === 'delete' && op.filename) {
      imageDeletes.push({ specificationId: op.specificationId, filename: op.filename })
    } else if (op.kind === 'create' && op.imageId) {
      imageRefs.push({ op: 'create', specificationId: op.specificationId, imageId: op.imageId })
    }
  }

  return {
    specs,
    proxyRefs: [], // Phase 3 does not emit proxyRefs from the store — they're inlined in spec.data on create
    specEnvs: [],
    imageDeletes,
    imageRefs,
  }
}
