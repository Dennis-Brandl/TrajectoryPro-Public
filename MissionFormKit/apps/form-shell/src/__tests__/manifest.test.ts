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

const here = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(here, '../..')
const tokens = JSON.parse(
  readFileSync(path.resolve(appRoot, '../../packages/form-tokens/tokens/form.json'), 'utf8'),
) as { color: { light: { accent: string; surface: string } } }

const icon = (name: string) => readFileSync(path.resolve(appRoot, 'public', name), 'utf8')

/**
 * The manifest's colours are derived from the token source at build time (vite.config.ts),
 * so they cannot drift. The ICONS are hand-authored SVG and carry the same colours as
 * literals — nothing but this test stops those from drifting, which is the exact failure
 * class this repo has already fixed twice (BREAKPOINTS vs tokens, layout.css vs BREAKPOINTS).
 */
describe('shell identity is pinned to the token source', () => {
  it('the vite config reads its manifest colours from tokens rather than hardcoding them', () => {
    const config = readFileSync(path.resolve(appRoot, 'vite.config.ts'), 'utf8')
    expect(config).toContain('tokens/form.json')
    expect(config).toMatch(/theme_color:\s*accent/)
    expect(config).toMatch(/background_color:\s*surface/)
    // A literal hex in the manifest block would mean the derivation had been undone.
    expect(config).not.toMatch(/(theme_color|background_color):\s*'#/)
  })

  it('both icons use the light accent and surface tokens', () => {
    const { accent, surface } = tokens.color.light
    expect(icon('icon.svg')).toContain(accent)
    expect(icon('icon.svg')).toContain(surface)
    expect(icon('icon-maskable.svg')).toContain(accent)
    expect(icon('icon-maskable.svg')).toContain(surface)
  })

  it('the maskable icon keeps its glyph inside the safe zone', () => {
    // An OS may crop a maskable icon to a circle; only the central 80% is guaranteed.
    // On a 192 viewBox that is x/y >= 19.2 and <= 172.8. A glyph outside it gets eaten.
    const svg = icon('icon-maskable.svg')
    const glyphs = [...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/g)]
    expect(glyphs.length).toBeGreaterThan(0)
    for (const [, x, y, w, h] of glyphs) {
      expect(Number(x)).toBeGreaterThanOrEqual(19.2)
      expect(Number(y)).toBeGreaterThanOrEqual(19.2)
      expect(Number(x) + Number(w)).toBeLessThanOrEqual(172.8)
      expect(Number(y) + Number(h)).toBeLessThanOrEqual(172.8)
    }
  })
})
