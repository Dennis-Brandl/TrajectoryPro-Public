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

// Phase 35 §2.6: filename allowlist + MIME magic-byte sniffer. Trusting the
// filename extension or the Content-Type header is forbidden; the server
// always sniffs the first bytes of the decoded buffer.

export const ALLOWED_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

const FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,254}$/

export function isAllowedFilename(name: string): boolean {
  if (!name) return false
  if (name.length > 255) return false
  if (name.includes('..')) return false
  if (!FILENAME_RE.test(name)) return false
  return true
}

/** Returns the sniffed MIME type or null if not recognized. */
export function sniffMime(buf: Buffer): string | null {
  if (buf.length < 4) return null
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png'
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg'
  }
  // GIF87a / GIF89a
  if (buf.length >= 6) {
    const first6 = buf.slice(0, 6).toString('ascii')
    if (first6 === 'GIF87a' || first6 === 'GIF89a') return 'image/gif'
  }
  // WebP: RIFF....WEBP
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return 'image/webp'
  }
  return null
}
