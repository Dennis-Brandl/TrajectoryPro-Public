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

// Spec 2026-10-09 §14 / R6: an author's block colour that falls below 3:1 against the
// form surface is dropped, and the block takes the theme's own colour. Designer authors
// on a light canvas, so in practice this fires in dark mode.

export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

export const MIN_AUTHORED_CONTRAST = 3

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
// rgb(1, 2, 3) · rgba(1, 2, 3, 0.5) · rgb(1 2 3) · rgb(1 2 3 / 50%)
const RGB = /^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*(?:[,/]\s*([\d.]+)(%?)\s*)?\)$/i

export function parseColor(input: string): Rgba | null {
  const s = input.trim()
  const hex = HEX.exec(s)
  if (hex) {
    let h = hex[1]!
    if (h.length <= 4) h = [...h].map((c) => c + c).join('')
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16)
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 }
  }
  const rgb = RGB.exec(s)
  if (rgb) {
    const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map(Number) as [number, number, number]
    if (r > 255 || g > 255 || b > 255) return null
    let a = 1
    if (rgb[4] !== undefined) {
      a = Number(rgb[4]) / (rgb[5] === '%' ? 100 : 1)
      if (!Number.isFinite(a)) return null
      a = Math.min(1, Math.max(0, a))
    }
    return { r, g, b, a }
  }
  return null
}

function channel(c: number): number {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function luminance({ r, g, b }: Rgba): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG 2 contrast ratio. A translucent `fg` is blended onto `bg` (taken as opaque) first. */
export function contrastRatio(fg: Rgba, bg: Rgba): number {
  const mix = (f: number, b: number) => f * fg.a + b * (1 - fg.a)
  const shown: Rgba = { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a: 1 }
  const l1 = luminance(shown)
  const l2 = luminance(bg)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

/**
 * The authored colour to draw, or `undefined` to fall back to the theme colour.
 * Passes the colour through untouched when there is no surface to judge against or
 * either value cannot be read — an unreadable inline colour is ignored by the browser
 * anyway. `resolve` turns other CSS colour syntaxes (named colours, hsl()) into rgb().
 */
export function guardAuthoredColor(
  color: string | undefined,
  surface: string | null | undefined,
  resolve?: (c: string) => string | null,
): string | undefined {
  if (!color || !surface) return color
  const bg = parseColor(surface)
  if (!bg) return color
  let fg = parseColor(color)
  if (!fg && resolve) {
    const resolved = resolve(color)
    fg = resolved ? parseColor(resolved) : null
  }
  if (!fg) return color
  return contrastRatio(fg, bg) < MIN_AUTHORED_CONTRAST ? undefined : color
}
