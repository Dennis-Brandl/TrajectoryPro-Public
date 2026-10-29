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
import { join } from 'node:path'
import { contrast } from './color-math'
import { TOKENS_CSS, resolveColor, type Mode } from './token-resolver'

// Spec §11, applied to the SHIPPED defaults (spec §18 "Contrast").
const PAIRS: Array<[fg: string, bg: string, min: number]> = [
  ['--pilot-text', '--pilot-surface', 4.5],
  ['--pilot-text', '--pilot-surface-raised', 4.5],
  ['--pilot-text-muted', '--pilot-surface-raised', 4.5],
  ['--pilot-text-muted', '--pilot-surface', 4.5],
  ['--pilot-text-muted', '--pilot-surface-sunken', 4.5],
  ['--pilot-accent-fg', '--pilot-accent', 4.5],
  ['--pilot-header-fg', '--pilot-header-bg', 4.5],
  ['--pilot-header-fg-muted', '--pilot-header-bg', 4.5],
  ['--pilot-overlay-fg', '--pilot-overlay-bg', 4.5],
  ['--pilot-overlay-fg-muted', '--pilot-overlay-bg', 4.5],
  ['--pilot-overlay-alarm', '--pilot-overlay-bg', 4.5],
  ['--pilot-alarm', '--pilot-surface-raised', 4.5],
  ['--pilot-border-strong', '--pilot-surface-raised', 3],
  ['--pilot-accent', '--pilot-surface-raised', 3],
  ['--pilot-focus', '--pilot-surface-raised', 3],
  ['--pilot-focus', '--pilot-header-bg', 3],
  ['--pilot-wc-accent', '--pilot-header-bg', 3],
  ['--pilot-header-ok', '--pilot-header-bg', 3],
  ['--pilot-header-warn', '--pilot-header-bg', 4.5],
  ['--pilot-overlay-ok', '--pilot-overlay-bg', 3],
  ['--pilot-ok', '--pilot-surface-raised', 4.5],
]

// Every --form-* token form-renderer consumes, minus the ones the bridge leaves to
// FormKit on purpose (spacing, padding, measure, line heights — spec §6.3).
const BRIDGED = [
  'color-surface', 'color-text', 'color-text-muted', 'color-border', 'color-accent', 'color-accent-text', 'color-danger',
  'type-font-family', 'type-size-xs', 'type-size-sm', 'type-size-md', 'type-size-lg', 'type-size-xl', 'type-size-2xl',
  'type-size-3xl', 'radius-control', 'touch-min-target',
]

function depthAt(css: string, index: number): number {
  let depth = 0
  for (let i = 0; i < index; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') depth--
  }
  return depth
}

const body = TOKENS_CSS.replace(/\/\*[\s\S]*?\*\//g, '')

describe('token sheet (spec §6)', () => {
  it('declares the layer order before any rule', () => {
    expect(body.trim().startsWith('@layer pilot.defaults, pilot.theme, pilot.prefs, pilot.components;')).toBe(true)
  })

  it('the FormKit bridge is unlayered and attribute-qualified, so it beats form-tokens.light.css', () => {
    const at = body.indexOf(':root[data-pilot-theme] {')
    expect(at).toBeGreaterThan(0)
    expect(depthAt(body, at)).toBe(0)
  })

  it('the bridge maps every FormKit token the renderer reads, except spacing', () => {
    const at = body.indexOf(':root[data-pilot-theme] {')
    const bridge = body.slice(at, body.indexOf('}', at))
    for (const name of BRIDGED) expect(bridge).toMatch(new RegExp(`--form-${name}:\\s*(var|calc)\\(`))
    expect(bridge).not.toMatch(/--form-space-|--form-control-padding|--form-measure|--form-type-line-height/)
  })

  for (const mode of ['light', 'dark'] as Mode[]) {
    it(`shipped ${mode} defaults pass every §11 contrast pair`, () => {
      const failures = PAIRS.map(([fg, bg, min]) => {
        const ratio = contrast(resolveColor(fg, mode), resolveColor(bg, mode))
        return { pair: `${fg} on ${bg}`, ratio: Number(ratio.toFixed(2)), min }
      }).filter((r) => r.ratio < r.min)
      expect(failures).toEqual([])
    })
  }

  // The GATE bars and caption are drawn INSIDE the diamond, on the fixed state fill,
  // not on the canvas — so the glyph must read on every fill a gate can show, in
  // both modes (final review: a light dark-mode glyph vanished on amber).
  for (const mode of ['light', 'dark'] as Mode[]) {
    it(`${mode}: the gate glyph reads on every state fill a gate can show`, () => {
      const fills = ['idle', 'waiting', 'paused', 'gate', 'properties', 'completed'].map((s) => `--pilot-state-${s}`)
      const failures = fills
        .map((bg) => ({ bg, ratio: Number(contrast(resolveColor('--pilot-diagram-glyph', mode), resolveColor(bg, mode)).toFixed(2)) }))
        .filter((r) => r.ratio < 3)
      expect(failures).toEqual([])
    })
  }

  it('index.html marks <html> for the bridge and loads the boot script before the bundle', () => {
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8')
    expect(html).toMatch(/<html lang="en" data-pilot-theme="default" data-pilot-mode="light">/)
    const boot = html.indexOf('<script src="/theme-boot.js"></script>')
    expect(boot).toBeGreaterThan(0)
    expect(boot).toBeLessThan(html.indexOf('type="module"'))
  })
})
