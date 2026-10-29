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
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { BREAKPOINTS } from '@mission/form-tokens'

const cssPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../layout.css')

describe('layout.css breakpoint boundaries', () => {
  it('container-query widths derive from BREAKPOINTS (tablet tier = desktopMin-1, phone tier = tabletMin-1)', () => {
    const css = readFileSync(cssPath, 'utf8')
    expect(css).toContain(`(max-width: ${BREAKPOINTS.desktopMinPx - 1}px)`)
    expect(css).toContain(`(max-width: ${BREAKPOINTS.tabletMinPx - 1}px)`)
  })
})

describe('layout.css button alignment', () => {
  it('Align places a button horizontally in its cell: start left, center middle, end right', () => {
    const css = readFileSync(cssPath, 'utf8')
    expect(css).toMatch(/\[data-block-type='button'\]\.tfk-align-start\s*\{[^}]*text-align:\s*left/)
    expect(css).toMatch(/\[data-block-type='button'\]\.tfk-align-center\s*\{[^}]*text-align:\s*center/)
    expect(css).toMatch(/\[data-block-type='button'\]\.tfk-align-end\s*\{[^}]*text-align:\s*right/)
  })
})

describe('controls.css per-device size classes', () => {
  const css = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../controls.css'), 'utf8')
  const tokens = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl']
  const tabletAt = css.indexOf('@container tfk (max-width: 1023px)')
  const phoneAt = css.indexOf('@container tfk (max-width: 599px)')

  it('has a tablet block and a phone block, phone after tablet', () => {
    expect(tabletAt).toBeGreaterThan(-1)
    expect(phoneAt).toBeGreaterThan(tabletAt)
  })
  it.each(tokens)('token %s has tablet and phone rules inside the right queries', (t) => {
    const tabletRule = css.indexOf(`.tfk-size-tablet-${t} `)
    const phoneRule = css.indexOf(`.tfk-size-phone-${t} `)
    expect(tabletRule).toBeGreaterThan(tabletAt)
    expect(tabletRule).toBeLessThan(phoneAt)
    expect(phoneRule).toBeGreaterThan(phoneAt)
  })
  it('base .tfk-size-* rules come before the tablet override block', () => {
    for (const t of tokens) {
      const base = css.indexOf(`.tfk-size-${t} `)
      expect(base).toBeGreaterThan(-1)
      expect(base).toBeLessThan(tabletAt)
    }
  })
  it('a disabled button reads as disabled and beats variant colours', () => {
    expect(css).toMatch(/\.tfk-button:disabled\s*\{[^}]*cursor:\s*not-allowed/)
    expect(css).toMatch(/\.tfk-button:disabled\s*\{[^}]*opacity/)
    expect(css.indexOf('.tfk-button:disabled')).toBeGreaterThan(css.indexOf('.tfk-button-secondary'))
  })
  it('the button font reset has zero specificity so a button size class applies', () => {
    expect(css).toContain(':where(.tfk-button) { font: inherit; }')
    const start = css.indexOf('\n.tfk-button {')
    const rule = css.slice(start, css.indexOf('}', start))
    expect(rule).not.toMatch(/font\s*:/)
  })
})
