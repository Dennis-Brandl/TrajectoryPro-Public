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

// Mirror imported image bytes into each spec's `data.images` map as base64
// data URIs. This is the symmetric counterpart of the export-side step that
// reads `spec.data.images` data URIs and emits ZIP entries; without it, the
// editor — which renders images exclusively out of `spec.data.images` —
// shows upload placeholders for every imported image even though the
// legacy image_blob/image tables were populated correctly.
//
// The function mutates `plan.specs[].dataJson` in place. It is a pure
// transform on the parsed envelope plan and the ZIP image list — no DB I/O —
// so it is safe to run before the import transaction opens.

import type { ImportPlan } from './parseEnvelope'
import type { SafeZipImage } from './safeZipReader'

/**
 * Resolve a single image reference to its bytes in the ZIP. Mirrors the
 * lookup precedence used by `insertImportImages`:
 *   1. bare filename               (client exports / UI parameter images)
 *   2. `{specSourceId}-{filename}` (legacy v3 server exports)
 *   3. suffix match on `-{filename}` (v7 form-element `{imageOid}-{filename}`)
 */
function resolveImageBytes(
  filename: string,
  specSourceId: string,
  byFilename: Map<string, SafeZipImage>,
  images: SafeZipImage[],
): SafeZipImage | undefined {
  const direct = byFilename.get(filename)
  if (direct) return direct
  const specPrefixed = byFilename.get(`${specSourceId}-${filename}`)
  if (specPrefixed) return specPrefixed
  const suffix = `-${filename}`
  for (const img of images) {
    if (img.filename.endsWith(suffix)) return img
  }
  return undefined
}

/**
 * Walk `plan.imageRefs[]` and inject each referenced image as a base64 data
 * URI under `spec.data.images[filename]` for the spec that owns it.
 *
 * The mutation is in place on `plan.specs[].dataJson`. References whose bytes
 * are not present in the ZIP are skipped silently — the import handler has
 * already cleared their `src` and removed them from `plan.imageRefs` upstream.
 */
export function injectSpecImagesAsDataUris(plan: ImportPlan, safeImages: SafeZipImage[]): void {
  if (plan.imageRefs.length === 0) return

  const byFilename = new Map<string, SafeZipImage>()
  for (const img of safeImages) byFilename.set(img.filename, img)

  // Group imageRefs by their owning spec — multiple form layouts (phone /
  // tablet / desktop) emit one ref per layout for the same image, so the
  // dedupe inside the spec loop matters.
  const refsBySpec = new Map<string, string[]>()
  for (const ref of plan.imageRefs) {
    const list = refsBySpec.get(ref.specSourceId) ?? []
    if (!list.includes(ref.filename)) list.push(ref.filename)
    refsBySpec.set(ref.specSourceId, list)
  }

  for (const spec of plan.specs) {
    const filenames = refsBySpec.get(spec.sourceId)
    if (!filenames || filenames.length === 0) continue

    let parsed: Record<string, unknown>
    try {
      const candidate = JSON.parse(spec.dataJson)
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
      parsed = candidate as Record<string, unknown>
    } catch {
      continue
    }

    const existing =
      parsed.images && typeof parsed.images === 'object' && !Array.isArray(parsed.images)
        ? ({ ...(parsed.images as Record<string, string>) } as Record<string, string>)
        : ({} as Record<string, string>)

    let changed = false
    for (const filename of filenames) {
      if (typeof existing[filename] === 'string' && existing[filename].startsWith('data:')) continue
      const img = resolveImageBytes(filename, spec.sourceId, byFilename, safeImages)
      if (!img) continue
      existing[filename] = `data:${img.mimeType};base64,${img.bytes.toString('base64')}`
      changed = true
    }

    if (!changed) continue
    parsed.images = existing
    spec.dataJson = JSON.stringify(parsed)
  }
}
