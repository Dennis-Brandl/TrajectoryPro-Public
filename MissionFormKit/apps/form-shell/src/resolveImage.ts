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
 * Maps the sample image src keys used by the demo flows to inline SVG data
 * URIs, so image blocks render without external assets. A real UI-host supplies
 * a resolver backed by the spec image map / package assets.
 */
const PLACEHOLDER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120">' +
      '<rect width="100%" height="100%" fill="#d4d4d8"/>' +
      '<text x="50%" y="50%" fill="#52525b" font-family="system-ui" font-size="14" ' +
      'text-anchor="middle" dominant-baseline="middle">image</text>' +
      '</svg>',
  )

const KNOWN: Record<string, string> = {
  'pump.jpg': PLACEHOLDER,
}

export function resolveImage(srcKey: string): string | undefined {
  return Object.hasOwn(KNOWN, srcKey) ? KNOWN[srcKey] : undefined
}
