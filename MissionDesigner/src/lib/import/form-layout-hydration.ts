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

import type { V1FormLayouts, V1FormLayout, V1Element } from '@mission/form-schema'
import { generateOID, WORKER_INTERNAL } from '@/lib/snowflake'
import { CANVAS_DIMS } from './canvas-dims'

/**
 * Hydrates form layout config from exported JSON into internal FormLayouts.
 * Regenerates element IDs with fresh snowflake OIDs — but uses the SAME id
 * for the i-th element across phone/tablet/desktop so the editor's
 * cross-layout sync (`updateElement` matches by `el.id === id`) actually
 * works. The exporter strips ids (`step-extractors.ts:189`) and writes each
 * layout's elements in addElement order, so index-based pairing is the
 * stable mapping back to "the same logical element across layouts."
 * Same rationale applies to image `imageOid` — shared per logical element.
 *
 * Also: strips stepOid prefix from image element src fields, unwraps
 * Text/Header content from the { content, plainText } RichTextContent
 * wrapper for Phase 23+ rich text display, and migrates a couple of
 * legacy field shapes.
 */
export function hydrateFormLayouts(
  formLayoutConfig:
    | Array<{ deviceType: string; canvasWidth: number; canvasHeight: number; elements: unknown[] }>
    | undefined,
  stepOid: string,
): V1FormLayouts | undefined {
  if (!formLayoutConfig || formLayoutConfig.length === 0) return undefined

  // Defaults track the editor's current CANVAS_DIMS so a freshly-imported workflow
  // missing a device layout entry gets the same canvas the editor would create today.
  const DEFAULTS: Record<string, { w: number; h: number }> = {
    phone: CANVAS_DIMS.phone,
    tablet: CANVAS_DIMS.tablet,
    desktop: CANVAS_DIMS.desktop,
  }

  const hydrateElement = (el: Record<string, unknown>, sharedId: string, sharedImageOid: string): V1Element => {
    const withId = { ...el, id: sharedId } as V1Element

    // Phase 23: Text/Header content is now an HTML string stored directly.
    // Maintain backward compatibility with Phase 15 export format: { content: string, plainText: string }
    if (withId.type === 'text' || withId.type === 'header') {
      const raw = (withId as unknown as Record<string, unknown>).content
      if (raw && typeof raw === 'object' && 'content' in (raw as Record<string, unknown>)) {
        // Phase 15 export format: { content: htmlOrText, plainText: stripped }
        // Prefer 'content' field (HTML) over 'plainText' (stripped text) for Phase 23 compatibility
        const richText = raw as { content: string; plainText: string }
        ;(withId as unknown as Record<string, unknown>).content = richText.content
      }
      // If raw is already a string (Phase 23+ format or legacy plain text), leave as-is
    }

    // Strip OID prefix from image src (ZIP stores as {imageOid}-{filename} or legacy {stepOid}-{filename})
    // V1Element already carries src/imageOid as loose optional strings — no narrowing cast needed.
    if (withId.type === 'image') {
      // Check for imageOid-based prefix first (new format), then stepOid (legacy)
      if (withId.imageOid) {
        const oidPrefix = `${withId.imageOid}-`
        if (withId.src && withId.src.startsWith(oidPrefix)) {
          withId.src = withId.src.slice(oidPrefix.length)
        }
      } else {
        const legacyPrefix = `${stepOid}-`
        if (withId.src && withId.src.startsWith(legacyPrefix)) {
          withId.src = withId.src.slice(legacyPrefix.length)
        }
        // Migrate: assign a stable imageOid for older elements that don't have one
        withId.imageOid = sharedImageOid
      }
    }

    // Migrate legacy defaultSource mode: 'parameter' → 'property'
    const ds = (withId as unknown as Record<string, unknown>).defaultSource as
      | { mode: string; value: string }
      | undefined
    if (ds && ds.mode === 'parameter') {
      ;(withId as unknown as Record<string, unknown>).defaultSource = {
        mode: 'property',
        value: ds.value,
      }
    }

    // Migrate legacy string[] options to OptionEntry[] format
    if (withId.type === 'checkbox' || withId.type === 'radio') {
      const opts = (withId as unknown as Record<string, unknown>).options as unknown[] | undefined
      if (opts && opts.length > 0 && typeof opts[0] === 'string') {
        // Legacy format: string[] → OptionEntry[]
        ;(withId as unknown as Record<string, unknown>).options = (opts as string[]).map((s) => ({
          label: s,
          value: s,
        }))
      }
    }

    return withId
  }

  const phoneSrc = formLayoutConfig.find((l) => l.deviceType === 'phone')?.elements ?? []
  const tabletSrc = formLayoutConfig.find((l) => l.deviceType === 'tablet')?.elements ?? []
  const desktopSrc = formLayoutConfig.find((l) => l.deviceType === 'desktop')?.elements ?? []
  const maxLen = Math.max(phoneSrc.length, tabletSrc.length, desktopSrc.length)

  // For each index, mint ONE shared id (and one shared imageOid for image
  // elements) and apply it to whichever layouts have an element at that
  // index. Cross-layout SYNCED_PROPERTIES sync depends on this.
  const phoneEls: V1Element[] = []
  const tabletEls: V1Element[] = []
  const desktopEls: V1Element[] = []
  for (let i = 0; i < maxLen; i++) {
    const sharedId = generateOID(WORKER_INTERNAL)
    const sharedImageOid = generateOID(WORKER_INTERNAL)
    if (i < phoneSrc.length)
      phoneEls.push(hydrateElement(phoneSrc[i] as Record<string, unknown>, sharedId, sharedImageOid))
    if (i < tabletSrc.length)
      tabletEls.push(hydrateElement(tabletSrc[i] as Record<string, unknown>, sharedId, sharedImageOid))
    if (i < desktopSrc.length)
      desktopEls.push(hydrateElement(desktopSrc[i] as Record<string, unknown>, sharedId, sharedImageOid))
  }

  const makeLayout = (deviceType: string, elements: V1Element[]): V1FormLayout => {
    const found = formLayoutConfig.find((l) => l.deviceType === deviceType)
    const defaults = DEFAULTS[deviceType] || DEFAULTS.phone
    return {
      canvasWidth: found?.canvasWidth ?? defaults.w,
      canvasHeight: found?.canvasHeight ?? defaults.h,
      elements,
    }
  }

  const result = {
    phone: makeLayout('phone', phoneEls),
    tablet: makeLayout('tablet', tabletEls),
    desktop: makeLayout('desktop', desktopEls),
  }

  // Legacy migration: old desktop (1280x800) → copy from tablet (768x1024)
  if (result.desktop.canvasWidth === 1280) {
    result.desktop = {
      canvasWidth: 768,
      canvasHeight: 1024,
      elements: [...result.tablet.elements],
    }
  }

  return result
}
