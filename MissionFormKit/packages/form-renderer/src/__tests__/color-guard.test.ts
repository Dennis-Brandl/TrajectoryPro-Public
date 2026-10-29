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
import { describe, it, expect } from 'vitest'
import { parseColor, contrastRatio, guardAuthoredColor, MIN_AUTHORED_CONTRAST } from '../color-guard'

const WHITE = 'rgb(255, 255, 255)'
// The Pilot's dark --pilot-surface-raised (#131c2e), as getComputedStyle reports it.
const DARK = 'rgb(19, 28, 46)'

describe('parseColor', () => {
  it('reads the four hex forms and rgb()/rgba() in comma and space syntax', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(parseColor('#0008')).toEqual({ r: 0, g: 0, b: 0, a: 0x88 / 255 })
    expect(parseColor('#1E293B')).toEqual({ r: 30, g: 41, b: 59, a: 1 })
    expect(parseColor('#00000080')).toEqual({ r: 0, g: 0, b: 0, a: 128 / 255 })
    expect(parseColor('rgb(19, 28, 46)')).toEqual({ r: 19, g: 28, b: 46, a: 1 })
    expect(parseColor('rgba(0, 0, 0, 0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 })
    expect(parseColor('rgb(0 0 0 / 25%)')).toEqual({ r: 0, g: 0, b: 0, a: 0.25 })
    expect(parseColor('  #ABC  ')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc, a: 1 })
  })

  it('returns null for anything else', () => {
    for (const s of ['', 'red', 'hsl(0 0% 0%)', '#12', '#12345', 'rgb(1,2)', 'rgb(300, 0, 0)', 'var(--x)']) {
      expect(parseColor(s), s).toBeNull()
    }
  })
})

describe('contrastRatio (WCAG 2)', () => {
  it('matches the WCAG reference points', () => {
    expect(contrastRatio(parseColor('#000')!, parseColor('#fff')!)).toBeCloseTo(21, 5)
    expect(contrastRatio(parseColor('#fff')!, parseColor('#fff')!)).toBeCloseTo(1, 5)
    expect(contrastRatio(parseColor('#ff0000')!, parseColor('#fff')!)).toBeCloseTo(3.998, 2)
  })

  it('is symmetric for opaque colours', () => {
    const a = parseColor('#1e293b')!
    const b = parseColor(DARK)!
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10)
  })

  it('blends a translucent foreground onto the background first', () => {
    // 10% black on white ≈ #e6e6e6 → far below 3:1.
    expect(contrastRatio(parseColor('rgba(0, 0, 0, 0.1)')!, parseColor('#fff')!)).toBeLessThan(1.3)
  })
})

describe('guardAuthoredColor (spec §14, R6)', () => {
  it('the threshold is exactly 3:1 — #949494 (3.03) stays on white, #959595 (2.995) goes', () => {
    expect(MIN_AUTHORED_CONTRAST).toBe(3)
    expect(guardAuthoredColor('#949494', WHITE)).toBe('#949494')
    expect(guardAuthoredColor('#959595', WHITE)).toBeUndefined()
  })

  it('Designer’s default dark text survives light mode and is dropped in dark mode', () => {
    expect(guardAuthoredColor('#1e293b', WHITE)).toBe('#1e293b')
    expect(guardAuthoredColor('#1e293b', DARK)).toBeUndefined()
  })

  it('yellow is dropped on white and kept on dark', () => {
    expect(guardAuthoredColor('#ffff00', WHITE)).toBeUndefined()
    expect(guardAuthoredColor('#ffff00', DARK)).toBe('#ffff00')
  })

  it('no colour, no surface, or an unreadable value: the authored value passes through', () => {
    expect(guardAuthoredColor(undefined, WHITE)).toBeUndefined()
    expect(guardAuthoredColor('#959595', null)).toBe('#959595')
    expect(guardAuthoredColor('#959595', undefined)).toBe('#959595')
    expect(guardAuthoredColor('#959595', 'var(--form-color-surface)')).toBe('#959595')
    expect(guardAuthoredColor('not-a-colour', WHITE)).toBe('not-a-colour')
  })

  it('a named colour is judged through the resolver when one is given', () => {
    const resolve = (c: string) => (c === 'black' ? 'rgb(0, 0, 0)' : null)
    expect(guardAuthoredColor('black', DARK, resolve)).toBeUndefined()
    expect(guardAuthoredColor('black', WHITE, resolve)).toBe('black')
    expect(guardAuthoredColor('rebeccapurple', DARK, resolve)).toBe('rebeccapurple')
  })
})
