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

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

// Every class the frame components render. A rename in TSX without the CSS (or the other
// way round) fails here instead of shipping an unstyled control.
const CLASSES = [
  'app-shell', 'app-scroll', 'work-view', 'work-panes',
  'top-bar', 'top-brand', 'top-logo', 'top-title', 'brand-when-light', 'brand-when-dark',
  'wc-switch', 'wc-switch-label', 'wc-switch-name',
  'conn', 'conn-ok', 'conn-warn', 'conn-wait', 'conn-icon', 'conn-word', 'conn-time',
  'op-btn', 'op-name', 'op-away', 'op-who', 'op-hint',
  'sheet-scrim', 'sheet', 'sheet-head', 'sheet-title', 'sheet-close',
  'claim-tab', 'claim-tab-step', 'claim-tab-meta', 'claim-tab-wf', 'sep', 'claims-open-btn', 'claims-sheet-item',
  'elide', 'elide-head', 'elide-tail', 'rid',
  'context-bar', 'ctx-field', 'ctx-step', 'ctx-workflow', 'ctx-runtime', 'ctx-wc', 'ctx-copy', 'ctx-copy-status',
  'shortcuts-sheet', 'shortcuts-table',
]

describe('frame.css', () => {
  const css = read('src/frame/frame.css').replace(/\/\*[\s\S]*?\*\//g, '')

  it('styles every class the frame renders, inside pilot.components', () => {
    expect(css.trim().startsWith('@layer pilot.components {')).toBe(true)
    const missing = CLASSES.filter((c) => !new RegExp(`\\.${c}(?![\\w-])`).test(css))
    expect(missing).toEqual([])
  })

  it('has the tablet rules (§4: below 1024 px) and is loaded after pilot.css', () => {
    expect(css).toContain('@media (max-width: 1023.98px)')
    const main = read('src/main.tsx')
    expect(main.indexOf("import './frame/frame.css'")).toBeGreaterThan(main.indexOf("import './pilot.css'"))
  })
})

describe('frame.css — Workstation (spec §16)', () => {
  const css = read('src/frame/frame.css').replace(/\/\*[\s\S]*?\*\//g, '')

  it('styles the split classes', () => {
    for (const c of ['work-view-split', 'work-main', 'work-rail', 'work-rail-note']) {
      expect(css, c).toMatch(new RegExp(`\\.${c}(?![\\w-])`))
    }
  })

  it('a paused claim in the rail keeps its indicator: the restore comes after the rail card border', () => {
    const card = css.indexOf('.work-rail .inbox-row,')
    const paused = css.indexOf('.work-rail .inbox-row-paused,')
    expect(card).toBeGreaterThan(-1)
    expect(paused).toBeGreaterThan(card)
    expect(css.slice(paused, css.indexOf('}', paused))).toContain('border-left: var(--pilot-indicator-w) solid var(--pilot-paused)')
  })

  it('the paused restore also covers the last row — the card rule includes :last-child, so it is (0,3,0) (final review)', () => {
    const at = css.indexOf('.work-rail .inbox-row-paused')
    const selector = css.slice(at, css.indexOf('{', at))
    expect(selector).toContain('.work-rail .inbox-row-paused:last-child')
  })

  it('"Where you are" joins the split view only from 1680 px', () => {
    expect(css).toContain('@media (min-width: 1680px)')
  })
})
