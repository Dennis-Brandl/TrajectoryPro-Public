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

import type { FormDocument } from '@mission/form-schema'
import type { MasterWorkflowStep } from './export-types'

// =============================================================================
// Image Collection Utilities
// =============================================================================

/**
 * Collects image filenames from workflow steps' UI parameter specifications.
 * Returns filenames that are not URLs (http/https) and not empty — these are
 * references to images stored in the images map.
 */
export function collectImageFilenames(steps: MasterWorkflowStep[]): string[] {
  const filenames: string[] = []
  for (const step of steps) {
    if (!step.ui_parameter_specifications) continue
    for (const param of step.ui_parameter_specifications) {
      if (param.type !== 'Image') continue
      if (!param.value) continue
      if (param.value.startsWith('http://') || param.value.startsWith('https://')) continue
      if (param.value.startsWith('data:')) continue
      filenames.push(param.value)
    }
  }
  return filenames
}

export interface FormElementImageEntry {
  zipPath: string
  imageStoreKey: string
}

/**
 * Collects form element image entries from exported workflow steps' v2
 * `form_document` (P4.1 — export never emits the retired `form_layout_config`
 * shape, so that field is not consulted here).
 * Returns entries with imageOid-prefixed zipPath to avoid filename collisions:
 * two different blocks that happen to share a filename but reference distinct
 * uploads (distinct imageOids) still get distinct ZIP entries. Skips
 * http/https URLs, data URIs, and the "No image selected" palette placeholder
 * (only local filename references with real bytes to bundle are packaged).
 * Deduplicated by imageOid — the same underlying image referenced by more than
 * one block (e.g. a duplicated image block) gets a single ZIP entry; a block
 * with no imageOid falls back to deduping by its full zipPath, the only
 * identity available for it.
 */
export function collectFormElementImages(steps: MasterWorkflowStep[]): FormElementImageEntry[] {
  const seen = new Set<string>()
  const entries: FormElementImageEntry[] = []

  for (const step of steps) {
    const doc = step.form_document as FormDocument | undefined
    if (!doc?.sections) continue
    for (const section of doc.sections) {
      for (const row of section.rows) {
        for (const block of row.blocks) {
          if (block.type !== 'image') continue
          const src = (block as { src?: string }).src
          if (!src) continue
          if (src.startsWith('http://') || src.startsWith('https://')) continue
          if (src.startsWith('data:')) continue
          if (src === 'No image selected') continue // palette default placeholder — no bytes to bundle
          const imageOid = (block as { imageOid?: string }).imageOid
          const prefix = imageOid || step.oid
          const zipPath = `${prefix}-${src}`
          const dedupeKey = imageOid || zipPath
          if (seen.has(dedupeKey)) continue
          seen.add(dedupeKey)
          entries.push({
            zipPath,
            imageStoreKey: src,
          })
        }
      }
    }
  }
  return entries
}
