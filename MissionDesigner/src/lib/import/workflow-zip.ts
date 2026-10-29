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
import { importWorkflow } from './workflow-importers'
import type { WorkflowImportSuccess, ImportError } from './import-types'

const MAX_ZIP_SIZE = 100 * 1024 * 1024 // 100MB max ZIP file size
const MAX_IMAGE_COUNT = 500 // Max images per ZIP
const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10MB per image
const BLOCKED_EXTENSIONS = new Set(['svg', 'html', 'htm', 'xml'])

/**
 * Infers a MIME type from a file extension.
 */
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
 * Imports a workflow from a ZIP file.
 *
 * Expects the ZIP to contain:
 *   - A `.WFmaster` file at the root (the workflow JSON)
 *   - An optional `images/` folder with image files
 *
 * Returns a WorkflowImportSuccess with the `images` field populated.
 */
export async function importWorkflowZip(file: File): Promise<WorkflowImportSuccess | ImportError> {
  if (file.size > MAX_ZIP_SIZE) {
    return {
      error: `File too large (${Math.round(file.size / 1024 / 1024)}MB). Maximum is ${MAX_ZIP_SIZE / 1024 / 1024}MB.`,
    }
  }

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(file)
  } catch {
    return { error: 'Failed to read ZIP file' }
  }

  // Find the .WFmaster file in the root
  let masterFile: JSZip.JSZipObject | null = null
  zip.forEach((relativePath, zipEntry) => {
    if (!zipEntry.dir && relativePath.endsWith('.WFmaster') && !relativePath.includes('/')) {
      masterFile = zipEntry
    }
  })

  if (!masterFile) {
    return { error: 'No .WFmaster file found in ZIP' }
  }

  // Parse the JSON
  let jsonData: unknown
  try {
    const text = await (masterFile as JSZip.JSZipObject).async('text')
    jsonData = JSON.parse(text)
  } catch {
    return { error: 'Invalid JSON in .WFmaster file' }
  }

  // Run through existing import pipeline
  const result = importWorkflow(jsonData)
  if ('error' in result) {
    return result
  }

  // Extract images from images/ folder
  const images: Record<string, string> = {}
  const imageFiles: Array<{ name: string; entry: JSZip.JSZipObject }> = []

  zip.forEach((relativePath, zipEntry) => {
    if (!zipEntry.dir && relativePath.startsWith('images/')) {
      const filename = relativePath.slice('images/'.length)
      if (filename) {
        imageFiles.push({ name: filename, entry: zipEntry })
      }
    }
  })

  // Limit number of images
  if (imageFiles.length > MAX_IMAGE_COUNT) {
    return { error: `Too many images (${imageFiles.length}). Maximum is ${MAX_IMAGE_COUNT}.` }
  }

  for (const { name, entry } of imageFiles) {
    // Block dangerous file types
    const ext = name.split('.').pop()?.toLowerCase() || ''
    if (BLOCKED_EXTENSIONS.has(ext)) continue

    const arrayBuffer = await entry.async('arraybuffer')

    // Skip oversized images
    if (arrayBuffer.byteLength > MAX_IMAGE_SIZE) continue

    // Efficient base64 encoding
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

  // For form element images stored with {stepOid}-{filename} prefix,
  // also store under the stripped filename so hydrated elements can find them.
  // Guard: prefix must be >= 8 chars and all digits (snowflake OIDs are long numeric strings).
  for (const fullKey of Object.keys(images)) {
    const dashIdx = fullKey.indexOf('-')
    if (dashIdx >= 8) {
      const prefix = fullKey.slice(0, dashIdx)
      if (/^\d+$/.test(prefix)) {
        const strippedKey = fullKey.slice(dashIdx + 1)
        if (!images[strippedKey]) {
          images[strippedKey] = images[fullKey]
        }
      }
    }
  }

  result.images = images
  return result
}
