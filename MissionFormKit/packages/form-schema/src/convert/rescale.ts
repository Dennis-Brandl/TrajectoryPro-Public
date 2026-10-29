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
import type { V1Element } from './v1-types'
import type { ConversionEntry } from './report'

const DESKTOP = { w: 1024, h: 768 }
const TABLET = { w: 1280, h: 720 }
const MIN_W = 20
const MIN_H = 16

/**
 * Pre-pass for the 4817b83 case: a desktop layout whose right edges overflow 1024 was
 * authored in tablet coordinate space. Rescale every element into the desktop canvas so
 * coordinates are trustworthy before clustering. Returns a new array; input is untouched.
 */
export function rescaleLegacyDesktop(elements: V1Element[], entries: ConversionEntry[]): V1Element[] {
  const overflow = elements.some((el) => el.x + el.width > DESKTOP.w)
  if (!overflow) return [...elements]

  const sx = DESKTOP.w / TABLET.w
  const sy = DESKTOP.h / TABLET.h
  return elements.map((el) => {
    entries.push({ kind: 'legacyRescale', blockId: el.id, detail: `rescaled from tablet space (${TABLET.w}x${TABLET.h}) to desktop (${DESKTOP.w}x${DESKTOP.h})` })
    return {
      ...el,
      x: Math.round(el.x * sx),
      y: Math.round(el.y * sy),
      width: Math.max(MIN_W, Math.round(el.width * sx)),
      height: Math.max(MIN_H, Math.round(el.height * sy)),
    }
  })
}
