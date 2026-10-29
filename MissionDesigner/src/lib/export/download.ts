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

import { saveAs } from 'file-saver'

/**
 * Download JSON data as a file.
 * @param data - The data to serialize and download
 * @param filename - The filename for the download (should end in .json)
 */
export function downloadJSON(data: unknown, filename: string): void {
  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
  saveAs(blob, filename)
}

/**
 * Download an image from a data URL.
 * @param dataUrl - The data URL (e.g., from canvas.toDataURL())
 * @param filename - The filename for the download
 */
export function downloadImage(dataUrl: string, filename: string): void {
  const link = document.createElement('a')
  link.download = filename
  link.href = dataUrl
  link.click()
}

/**
 * Download a blob directly using file-saver.
 * @param blob - The Blob to download
 * @param filename - The filename for the download
 */
export function downloadBlob(blob: Blob, filename: string): void {
  saveAs(blob, filename)
}

/**
 * Download a ZIP blob.
 * @param blob - The ZIP Blob to download
 * @param filename - The filename for the download (should end in .zip)
 */
export function downloadZip(blob: Blob, filename: string): void {
  saveAs(blob, filename)
}
