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

import JSZip from 'jszip'
import type { EntityType } from '@/types/library'
import type { ImportError } from './import-types'

const MAX_IMAGE_COUNT = 500
const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10MB per image
const BLOCKED_EXTENSIONS = new Set(['svg', 'html', 'htm', 'xml'])

// =============================================================================
// Package-type detection (manifest-first, extension-fallback)
// =============================================================================

/**
 * The canonical set of package types recognised by the importer.
 * - 'action-library'       → .WFactionLibX or legacy .WFactionX
 * - 'environment-library'  → .WFenvirLibX or legacy .WFenvirX (without manifest)
 * - 'step-library'         → .WFstepLibX or legacy .WFslibX
 * - 'workflow-library'     → .WFlibX
 * - 'environment-package'  → .WFenvirX WITH manifest.packageType = 'environment-package'
 */
export type DetectedPackageType =
  | 'action-library'
  | 'environment-library'
  | 'step-library'
  | 'workflow-library'
  | 'environment-package'

/**
 * Detect what kind of package a ZIP file contains.
 *
 * Detection order:
 * 1. If `manifest.json` is present and carries a known `packageType`, return it.
 * 2. Fall back to inspecting root file extensions (backward compat for packages
 *    that predate the manifest).
 *
 * Returns `null` when neither heuristic matches — the caller should surface an
 * error to the user.
 */
export async function detectPackageType(zip: JSZip): Promise<DetectedPackageType | null> {
  // 1. Manifest-first detection
  const manifestFile = zip.file('manifest.json')
  if (manifestFile) {
    try {
      const manifest = JSON.parse(await manifestFile.async('text')) as Record<string, unknown>
      const t = manifest.packageType
      if (
        t === 'action-library' ||
        t === 'environment-library' ||
        t === 'step-library' ||
        t === 'workflow-library' ||
        t === 'environment-package'
      ) {
        return t as DetectedPackageType
      }
    } catch {
      // Malformed manifest — fall through to extension detection
    }
  }

  // 2. Extension-based fallback (legacy packages without manifest)
  const rootNames = Object.keys(zip.files).filter((n) => !n.includes('/') && !zip.files[n].dir)

  if (rootNames.some((n) => n.endsWith('.WFactionLibX') || n.endsWith('.WFactionX'))) return 'action-library'
  if (rootNames.some((n) => n.endsWith('.WFenvirLibX'))) return 'environment-library'
  if (rootNames.some((n) => n.endsWith('.WFstepLibX') || n.endsWith('.WFslibX'))) return 'step-library'
  if (rootNames.some((n) => n.endsWith('.WFlibX'))) return 'workflow-library'
  // Legacy .WFenvirX with no manifest → treat as old-format environment library
  if (rootNames.some((n) => n.endsWith('.WFenvirX'))) return 'environment-library'
  // Legacy inner-content forms (the X was on the ZIP, inner file had no X)
  if (rootNames.some((n) => n.endsWith('.WFaction'))) return 'action-library'
  if (rootNames.some((n) => n.endsWith('.WFenvir'))) return 'environment-library'
  if (rootNames.some((n) => n.endsWith('.WFslib'))) return 'step-library'

  return null
}

function mimeFromExtension(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  switch (ext) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'bmp':
      return 'image/bmp'
    case 'ico':
      return 'image/x-icon'
    default:
      return 'application/octet-stream'
  }
}

/**
 * Result of parsing a library package ZIP (action, environment, or step).
 */
export interface LibraryPackageResult {
  libraryName: string
  libraryJson: unknown
  entityType: EntityType
  environmentLibraries: Array<{ name: string; json: unknown }>
  actionLibraries: Array<{ name: string; json: unknown }>
  images: Record<string, string>
}

/**
 * Result of parsing a single-environment package ZIP (.WFenvirX with manifest
 * packageType 'environment-package').
 *
 * Shape:
 * - `envSpecJson`     — the raw `MasterEnvironmentSpecification` JSON from the
 *                       root `.WFenvir` file (no library wrapper).
 * - `envName`         — local_id / library_name from the env spec or manifest.
 * - `actionLibraries` — one entry per source action library; each carries the
 *                       library name plus its action specs. The importer
 *                       creates/reuses the named library and adds these specs
 *                       to it (add-only). v1 packages (flat actions/) are
 *                       normalized into this shape on read using the env
 *                       spec's `included_actions[].action_library` mapping.
 */
export interface EnvironmentPackageResult {
  packageType: 'environment-package'
  envName: string
  envSpecJson: unknown
  actionLibraries: Array<{
    libraryName: string
    actionSpecs: Array<{ name: string; json: unknown }>
  }>
}

/**
 * Imports a library package ZIP file (action, environment, or step) OR a
 * single-environment package (.WFenvirX with manifest).
 *
 * Detection is manifest-first:
 *  1. If `manifest.json` carries a known `packageType`, route on that.
 *  2. Otherwise fall back to root file extension (legacy packages).
 *
 * Returns:
 *  - `LibraryPackageResult`        for action / environment-library / step / workflow packages
 *  - `EnvironmentPackageResult`    for single-environment packages
 *  - `ImportError`                 on any parse failure
 *
 * Parses the ZIP and extracts:
 * - .WFaction / .WFenvir / .WFslib at root → library JSON (current format)
 * - .WFactionX / .WFenvirX / .WFslibX at root → library JSON (legacy, for
 *   packages exported before the inner-JSON naming fix)
 * - environments/*.WFenvir files → environment libraries
 * - actions/*.WFaction files → action libraries
 * - images/* files → data URIs
 */
export async function importLibraryPackage(
  file: File,
): Promise<LibraryPackageResult | EnvironmentPackageResult | ImportError> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(file)
  } catch {
    return { error: 'Failed to read library package ZIP file' }
  }

  // Manifest-first package-type detection
  const pkgType = await detectPackageType(zip)

  // Route environment-package to its own extraction path
  if (pkgType === 'environment-package') {
    return importEnvironmentPackageZip(zip)
  }

  // All other types use the library-shell extraction path below.
  // Find the main library file at root — detect type from extension.
  // Accept both the current non-X form and the legacy X-suffixed form that
  // earlier exports produced (the X was reserved for the outer ZIP).
  // Also accept the new library-extension names (.WFactionLibX, .WFenvirLibX, .WFstepLibX).
  let mainFile: JSZip.JSZipObject | null = null
  let libraryName = 'Library'
  let entityType: EntityType = 'action'

  const INNER_MATCHERS: Array<{ pattern: RegExp; type: EntityType }> = [
    { pattern: /\.WFactionLibX$/, type: 'action' },
    { pattern: /\.WFaction(X)?$/, type: 'action' },
    { pattern: /\.WFenvirLibX$/, type: 'environment' },
    { pattern: /\.WFenvir(X)?$/, type: 'environment' },
    { pattern: /\.WFstepLibX$/, type: 'step' },
    { pattern: /\.WFslib(X)?$/, type: 'step' },
  ]

  zip.forEach((relativePath, zipEntry) => {
    if (zipEntry.dir || relativePath.includes('/')) return
    if (mainFile) return
    for (const { pattern, type } of INNER_MATCHERS) {
      if (pattern.test(relativePath)) {
        mainFile = zipEntry
        libraryName = relativePath.replace(pattern, '')
        entityType = type
        return
      }
    }
  })

  if (!mainFile) {
    return { error: 'No library file (.WFaction, .WFenvir, or .WFslib) found in package' }
  }

  // Parse main library JSON
  let libraryJson: unknown
  try {
    const text = await (mainFile as JSZip.JSZipObject).async('text')
    libraryJson = JSON.parse(text)
  } catch {
    return { error: 'Invalid JSON in library file' }
  }

  // Try manifest for library name
  const manifestEntry = zip.file('manifest.json')
  if (manifestEntry) {
    try {
      const manifestText = await manifestEntry.async('text')
      const manifest = JSON.parse(manifestText) as Record<string, unknown>
      if (typeof manifest.libraryName === 'string') libraryName = manifest.libraryName
    } catch (e) {
      console.error('[import] Failed to parse manifest.json:', e)
    }
  }

  // Read environment library files
  const environmentLibraries: Array<{ name: string; json: unknown }> = []
  const envEntries: Array<{ name: string; entry: JSZip.JSZipObject }> = []
  zip.forEach((relativePath, zipEntry) => {
    if (!zipEntry.dir && relativePath.startsWith('environments/') && relativePath.endsWith('.WFenvir')) {
      const name = relativePath.slice('environments/'.length).replace(/\.WFenvir$/, '')
      if (name) envEntries.push({ name, entry: zipEntry })
    }
  })
  for (const { name, entry } of envEntries) {
    try {
      const text = await entry.async('text')
      environmentLibraries.push({ name, json: JSON.parse(text) })
    } catch (e) {
      console.error(`[import] Failed to parse environment "${name}":`, e)
    }
  }

  // Read action library files
  const actionLibraries: Array<{ name: string; json: unknown }> = []
  const actionEntries: Array<{ name: string; entry: JSZip.JSZipObject }> = []
  zip.forEach((relativePath, zipEntry) => {
    if (!zipEntry.dir && relativePath.startsWith('actions/') && relativePath.endsWith('.WFaction')) {
      const name = relativePath.slice('actions/'.length).replace(/\.WFaction$/, '')
      if (name) actionEntries.push({ name, entry: zipEntry })
    }
  })
  for (const { name, entry } of actionEntries) {
    try {
      const text = await entry.async('text')
      actionLibraries.push({ name, json: JSON.parse(text) })
    } catch (e) {
      console.error(`[import] Failed to parse action "${name}":`, e)
    }
  }

  // Read images
  const images: Record<string, string> = {}
  const imageEntries: Array<{ name: string; entry: JSZip.JSZipObject }> = []
  zip.forEach((relativePath, zipEntry) => {
    if (!zipEntry.dir && relativePath.startsWith('images/')) {
      const filename = relativePath.slice('images/'.length)
      if (filename) imageEntries.push({ name: filename, entry: zipEntry })
    }
  })

  if (imageEntries.length > MAX_IMAGE_COUNT) {
    return { error: `Too many images (${imageEntries.length}). Maximum is ${MAX_IMAGE_COUNT}.` }
  }

  for (const { name, entry } of imageEntries) {
    const ext = name.split('.').pop()?.toLowerCase() || ''
    if (BLOCKED_EXTENSIONS.has(ext)) continue
    const arrayBuffer = await entry.async('arraybuffer')
    if (arrayBuffer.byteLength > MAX_IMAGE_SIZE) continue
    const bytes = new Uint8Array(arrayBuffer)
    const chunks: string[] = []
    const CHUNK_SIZE = 8192
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
      chunks.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE)))
    }
    const base64 = btoa(chunks.join(''))
    const mime = mimeFromExtension(name)
    images[name] = `data:${mime};base64,${base64}`
  }

  // Strip imageOid prefix for form element image deduplication
  for (const fullKey of Object.keys(images)) {
    const dashIdx = fullKey.indexOf('-')
    if (dashIdx >= 8) {
      const prefix = fullKey.slice(0, dashIdx)
      if (/^\d+$/.test(prefix)) {
        const strippedKey = fullKey.slice(dashIdx + 1)
        if (!images[strippedKey]) images[strippedKey] = images[fullKey]
      }
    }
  }

  return {
    libraryName,
    libraryJson,
    entityType,
    environmentLibraries,
    actionLibraries,
    images,
  }
}

// =============================================================================
// Single-environment package extraction (environment-package)
// =============================================================================

/**
 * Extract a single-environment package ZIP.
 *
 * Expected shape:
 *   {EnvName}.WFenvir        — raw MasterEnvironmentSpecification (no library wrapper)
 *   actions/{Name}.WFaction  — raw MasterActionSpecification(s)
 *   manifest.json            — metadata (already consumed by detectPackageType)
 */
async function importEnvironmentPackageZip(zip: JSZip): Promise<EnvironmentPackageResult | ImportError> {
  // Find the root .WFenvir file
  let envFile: JSZip.JSZipObject | null = null
  let envName = 'Environment'

  zip.forEach((relativePath, zipEntry) => {
    if (zipEntry.dir || relativePath.includes('/')) return
    if (relativePath.endsWith('.WFenvir') && !envFile) {
      envFile = zipEntry
      envName = relativePath.replace(/\.WFenvir$/, '')
    }
  })

  if (!envFile) {
    return { error: 'No .WFenvir file found in environment package' }
  }

  // Parse env spec JSON
  let envSpecJson: unknown
  try {
    const text = await (envFile as JSZip.JSZipObject).async('text')
    envSpecJson = JSON.parse(text)
  } catch {
    return { error: 'Invalid JSON in environment spec file' }
  }

  // Use local_id from the spec as the canonical name if available
  if (envSpecJson && typeof envSpecJson === 'object') {
    const specObj = envSpecJson as Record<string, unknown>
    if (typeof specObj.local_id === 'string' && specObj.local_id) {
      envName = specObj.local_id
    } else if (typeof specObj.library_name === 'string' && specObj.library_name) {
      envName = specObj.library_name
    }
  }

  // Walk actions/. v2 layout is `actions/{libraryName}/{actionName}.WFaction`
  // (one subdir per source action library). v1 layout was flat
  // `actions/{actionName}.WFaction`. Parse both, normalize to library-grouped
  // result. v1 actions are reassigned to libraries via the env spec's
  // included_actions[].action_library mapping; anything unmatched lands under
  // a synthetic library named after the env.
  type ActionEntry = { libraryName: string | null; name: string; entry: JSZip.JSZipObject }
  const actionEntries: ActionEntry[] = []

  zip.forEach((relativePath, zipEntry) => {
    if (zipEntry.dir || !relativePath.endsWith('.WFaction')) return
    if (!relativePath.startsWith('actions/')) return
    const rest = relativePath.slice('actions/'.length)
    const parts = rest.split('/')
    if (parts.length === 1) {
      // v1 flat: actions/{name}.WFaction
      const name = parts[0].replace(/\.WFaction$/, '')
      if (name) actionEntries.push({ libraryName: null, name, entry: zipEntry })
    } else if (parts.length === 2) {
      // v2 grouped: actions/{lib}/{name}.WFaction
      const libraryName = parts[0]
      const name = parts[1].replace(/\.WFaction$/, '')
      if (libraryName && name) actionEntries.push({ libraryName, name, entry: zipEntry })
    }
    // Deeper nesting silently ignored — package format doesn't define it.
  })

  // For v1 fallback, build a name → library map from the env spec's included_actions.
  const v1Mapping = new Map<string, string>()
  if (envSpecJson && typeof envSpecJson === 'object') {
    const envObj = envSpecJson as Record<string, unknown>
    const refs = (envObj.included_actions ?? envObj.includedActions) as Array<Record<string, unknown>> | undefined
    for (const ref of refs ?? []) {
      const actionName = (ref.action_name ?? ref.actionName) as string | undefined
      const libName = (ref.action_library ?? ref.actionLibrary) as string | undefined
      if (typeof actionName === 'string' && typeof libName === 'string' && actionName && libName) {
        v1Mapping.set(actionName, libName)
      }
    }
  }

  const byLibrary = new Map<string, Array<{ name: string; json: unknown }>>()
  const ensureLib = (libName: string) => {
    if (!byLibrary.has(libName)) byLibrary.set(libName, [])
    return byLibrary.get(libName)!
  }

  for (const { libraryName, name, entry } of actionEntries) {
    let json: unknown
    try {
      json = JSON.parse(await entry.async('text'))
    } catch (e) {
      console.error(`[import] Failed to parse action spec "${name}":`, e)
      continue
    }
    const resolvedLib = libraryName ?? v1Mapping.get(name) ?? envName
    ensureLib(resolvedLib).push({ name, json })
  }

  return {
    packageType: 'environment-package',
    envName,
    envSpecJson,
    actionLibraries: [...byLibrary.entries()].map(([libraryName, actionSpecs]) => ({
      libraryName,
      actionSpecs,
    })),
  }
}
