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

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const pilot = strip(readFileSync(join(process.cwd(), 'src/pilot.css'), 'utf8'))

// Every class the inbox, the work-center cards and the diagram chrome render. A rename in
// TSX without the CSS (or the other way round) fails here instead of shipping unstyled.
const CLASSES = [
  'inbox', 'inbox-toolbar', 'inbox-filter', 'inbox-section', 'inbox-section-head', 'inbox-count', 'inbox-empty',
  'inbox-list', 'inbox-row', 'inbox-row-paused', 'inbox-step', 'inbox-step-name', 'inbox-open', 'inbox-badge',
  'inbox-badge-paused', 'inbox-workflow', 'inbox-runtime', 'inbox-age', 'inbox-action', 'inbox-claim',
  'picker', 'picker-title', 'wc-cards', 'wc-card', 'wc-card-name', 'wc-card-meta', 'wc-card-path', 'wc-card-count',
  'wc-list-error', 'wc-list-empty', 'wf-graph-scroll', 'wf-legend-glyph',
]

function rule(css: string, sel: string): string {
  const at = css.indexOf(`${sel} {`)
  expect(at, sel).toBeGreaterThanOrEqual(0)
  return css.slice(at, css.indexOf('}', at))
}

describe('inbox, picker and diagram styles (spec §5.5, §5.7)', () => {
  it('styles every class those screens render', () => {
    const missing = CLASSES.filter((c) => !new RegExp(`\\.${c}(?![\\w-])`).test(pilot))
    expect(missing).toEqual([])
  })

  it('tasks are cards below 1024 px and full-width rows from 1024 px', () => {
    expect(rule(pilot, '.inbox-row')).toMatch(/grid-template-areas:/)
    const wide = pilot.slice(pilot.indexOf('@media (min-width: 1024px)'))
    expect(wide).toMatch(/\.inbox-row \{[^}]*'step workflow runtime age action'/)
  })

  it('the diagram scrolls inside its box instead of shrinking (P1d-R3)', () => {
    expect(rule(pilot, '.wf-graph-scroll')).toMatch(/overflow:\s*auto/)
  })

  it('link buttons are full touch targets and never pick up the plain-button hover (P1c minors)', () => {
    expect(rule(pilot, '.link-btn')).toMatch(/min-width:\s*var\(--pilot-touch-min\)/)
    expect(rule(pilot, '.link-btn:hover:not(:disabled)')).toMatch(/background:\s*transparent/)
    expect(rule(pilot, '.inbox-open')).toMatch(/min-width:\s*var\(--pilot-touch-min\)/)
    expect(rule(pilot, '.inbox-open:hover:not(:disabled)')).toMatch(/background:\s*transparent/)
  })
})
