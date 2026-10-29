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
import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { BREAKPOINTS } from '../index'

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

beforeAll(() => {
  execFileSync('node', [path.join(pkgRoot, 'scripts/build.mjs')])
})

describe('form-tokens build', () => {
  it('generates light and dark CSS with the --form- prefix on every property', () => {
    for (const theme of ['light', 'dark'] as const) {
      const css = readFileSync(path.join(pkgRoot, `dist/form-tokens.${theme}.css`), 'utf8')
      expect(css).toContain(':root')
      const propLines = css.split('\n').filter((l) => l.trim().startsWith('--'))
      expect(propLines.length).toBeGreaterThan(0)
      for (const line of propLines) {
        expect(line.trim()).toMatch(/^--form-/)
      }
    }
  })

  it('emits the spacing and type scales', () => {
    const css = readFileSync(path.join(pkgRoot, 'dist/form-tokens.light.css'), 'utf8')
    expect(css).toContain('--form-space-md: 1rem;')
    expect(css).toContain('--form-type-size-xl: 1.5rem;')
    expect(css).toContain('--form-touch-min-target: 2.75rem;')
    expect(css).toContain('--form-measure-text: 70ch;')
    expect(css).toContain('--form-radius-control: 0.375rem;')
  })

  it('themes differ only in color values', () => {
    const light = readFileSync(path.join(pkgRoot, 'dist/form-tokens.light.css'), 'utf8')
    const dark = readFileSync(path.join(pkgRoot, 'dist/form-tokens.dark.css'), 'utf8')
    expect(light).toContain('--form-color-surface: #ffffff;')
    expect(dark).toContain('--form-color-surface: #0f172a;')
    const stripColors = (s: string) =>
      s.split('\n').filter((l) => !l.includes('--form-color-')).join('\n')
    expect(stripColors(light)).toBe(stripColors(dark))
  })

  it('exports breakpoint constants matching the spec (600 / 1024)', () => {
    expect(BREAKPOINTS).toEqual({ tabletMinPx: 600, desktopMinPx: 1024 })
  })

  it('BREAKPOINTS matches the token source of truth (tokens/form.json)', () => {
    const tokens = JSON.parse(readFileSync(path.join(pkgRoot, 'tokens/form.json'), 'utf8'))
    expect(BREAKPOINTS).toEqual(tokens.breakpoint)
  })
})
