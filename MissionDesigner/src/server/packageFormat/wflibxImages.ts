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

// Image handling for .WFlibX imports. The form designer and the library re-export read a
// picture only from its spec's `data.images`, so the import must fill that map as well as the
// image tables that runtime packages are built from. Counterpart of injectSpecImages.ts, which
// does this for single-workflow packages.

import { ALLOWED_IMAGE_MIMES, sniffMime } from '../imageMime'

/**
 * The bytes for one image reference, from a map keyed by zip path. A bundle holds pictures from
 * many specs, and two of them can share a filename, so the reference's own `imageOid` is tried
 * first: `images/{imageOid}-{filename}`, then `images/{filename}`, then any `-{filename}` suffix.
 */
export function findBundleImage(
  imageBytes: Record<string, Uint8Array>,
  filename: string,
  imageOid?: string,
): Uint8Array | undefined {
  const own = imageOid ? imageBytes[`images/${imageOid}-${filename}`] : undefined
  if (own) return own
  const bare = imageBytes[`images/${filename}`]
  if (bare) return bare
  const suffix = `-${filename}`
  for (const [path, bytes] of Object.entries(imageBytes)) {
    if (path.startsWith('images/') && path.endsWith(suffix)) return bytes
  }
  return undefined
}

function isLocalImageName(src: unknown): src is string {
  return (
    typeof src === 'string' &&
    src.length > 0 &&
    src !== 'No image selected' &&
    !src.startsWith('data:') &&
    !/^https?:/.test(src)
  )
}

/** Every local image a spec's forms use, by the exact name the form looks it up with. */
function collectImageRefs(data: Record<string, unknown>): Map<string, string | undefined> {
  const refs = new Map<string, string | undefined>()
  const nodes = Array.isArray(data.nodes) ? (data.nodes as Array<Record<string, unknown>>) : []
  for (const node of nodes) {
    const inner = node.data as Record<string, unknown> | undefined

    const doc = inner?.formDocument as
      | { sections?: Array<{ rows?: Array<{ blocks?: Array<Record<string, unknown>> }> }> }
      | undefined
    for (const section of doc?.sections ?? []) {
      for (const row of section.rows ?? []) {
        for (const block of row.blocks ?? []) {
          if (block.type !== 'image' || !isLocalImageName(block.src)) continue
          if (!refs.get(block.src)) {
            refs.set(block.src, typeof block.imageOid === 'string' ? block.imageOid : undefined)
          }
        }
      }
    }

    const layouts = inner?.formLayouts
    if (!layouts || typeof layouts !== 'object') continue
    for (const layout of Object.values(layouts)) {
      const elements = (layout as { elements?: unknown } | null)?.elements
      if (!Array.isArray(elements)) continue
      for (const el of elements as Array<Record<string, unknown> | null>) {
        if (el?.type !== 'image' || !isLocalImageName(el.src)) continue
        if (!refs.has(el.src)) refs.set(el.src, undefined)
      }
    }
  }
  return refs
}

/**
 * Add each picture a workflow or step spec's forms use to its `data.images` as a data URI. Mutates
 * `data`. A reference with no bytes in the bundle, or bytes that are not an allowed image type, is
 * left out: insertWflibxImagesForSpec walks the same references and reports the bad type.
 */
export function injectWflibxImages(data: Record<string, unknown>, imageBytes: Record<string, Uint8Array>): void {
  const images: Record<string, string> = {}
  for (const [filename, imageOid] of collectImageRefs(data)) {
    const bytes = findBundleImage(imageBytes, filename, imageOid)
    if (!bytes) continue
    const buf = Buffer.from(bytes)
    const mimeType = sniffMime(buf)
    if (!mimeType || !ALLOWED_IMAGE_MIMES.has(mimeType)) continue
    images[filename] = `data:${mimeType};base64,${buf.toString('base64')}`
  }
  if (Object.keys(images).length > 0) data.images = images
}
