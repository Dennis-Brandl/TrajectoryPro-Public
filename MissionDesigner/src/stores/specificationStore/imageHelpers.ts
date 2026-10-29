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
 * Pure helper functions for managing images in `spec.data.images`.
 *
 * All functions read from and write to the specificationStore via getState().
 * Components should import these helpers instead of touching updateSpecData
 * directly, so that image storage semantics remain in one place.
 */

import { useSpecificationStore } from '@/stores/specificationStore'
import type { WorkflowNode } from '@/types/nodes'

// ─── Internal ────────────────────────────────────────────────────────────────

/**
 * Read the current images map for a spec.
 * Returns an empty object if the spec is missing or has no images key.
 */
function readImages(specId: string | null): Record<string, string> {
  if (specId == null) return {}
  const spec = useSpecificationStore.getState().specs.get(specId)
  if (!spec) return {}
  return (spec.data.images as Record<string, string> | undefined) ?? {}
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns `spec.data.images` for the given specId, or an empty object if
 * the spec is missing, has no images key, or specId is null.
 */
export function getSpecImages(specId: string | null): Record<string, string> {
  return readImages(specId)
}

/**
 * Adds or replaces a single image entry in `spec.data.images`.
 * Merges with existing images — does not clobber other entries.
 * No-op if specId is null.
 */
export function setSpecImage(specId: string | null, filename: string, dataUri: string): void {
  if (specId == null) return
  const existing = readImages(specId)
  useSpecificationStore.getState().updateSpecData(specId, {
    images: { ...existing, [filename]: dataUri },
  })
}

/**
 * Returns `name` if it is not already a key in `existing`, otherwise inserts a `-1`, `-2`, …
 * counter before the file extension until the name is unique. Keeps a picked file's original
 * name where possible (nicer export naming) without clobbering a different image of the same
 * name. Pure.
 */
export function dedupeImageFilename(existing: Record<string, string>, name: string): string {
  if (!(name in existing)) return name
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  let n = 1
  while (`${base}-${n}${ext}` in existing) n++
  return `${base}-${n}${ext}`
}

/**
 * Removes a single image entry by filename from `spec.data.images`.
 * Idempotent: safe to call even if the filename does not exist.
 * No-op if specId is null.
 */
export function removeSpecImage(specId: string | null, filename: string): void {
  if (specId == null) return
  const existing = readImages(specId)
  if (!(filename in existing)) return
  const updated = { ...existing }
  delete updated[filename]
  useSpecificationStore.getState().updateSpecData(specId, { images: updated })
}

/**
 * Replaces the entire images map in `spec.data.images` with the provided map.
 * Use this for bulk operations like import, where you want to set all images at once.
 * No-op if specId is null.
 */
export function setSpecImages(specId: string | null, images: Record<string, string>): void {
  if (specId == null) return
  useSpecificationStore.getState().updateSpecData(specId, { images })
}

/**
 * Walks all nodes' `formDocument` (v2), finds image blocks with local
 * filenames (non-http/https src values), and returns a map of filename →
 * dataURI for only the images that are actually referenced.
 *
 * Use this when you need a snapshot of images in use (e.g. for export).
 * Returns an empty object if specId is null.
 */
export function snapshotReferencedImages(
  specId: string | null,
  nodes: readonly WorkflowNode[],
): Record<string, string> {
  if (specId == null) return {}
  const allImages = readImages(specId)
  const result: Record<string, string> = {}

  for (const node of nodes) {
    const formDocument = (
      node.data as {
        formDocument?: { sections?: Array<{ rows?: Array<{ blocks?: Array<{ type?: string; src?: string }> }> }> }
      }
    )?.formDocument
    if (formDocument?.sections) {
      for (const section of formDocument.sections) {
        for (const row of section.rows ?? []) {
          for (const block of row.blocks ?? []) {
            if (block.type !== 'image') continue
            const src = block.src
            if (!src) continue
            if (src.startsWith('http://') || src.startsWith('https://')) continue
            if (src in allImages && !(src in result)) result[src] = allImages[src]
          }
        }
      }
    }
  }

  return result
}
