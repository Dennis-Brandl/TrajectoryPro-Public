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
const frame = strip(readFileSync(join(process.cwd(), 'src/frame/frame.css'), 'utf8'))

// Every class the task screen renders. A rename in TSX without the CSS (or the other way
// round) fails here instead of shipping an unstyled control.
const CLASSES = [
  'task-heading', 'task-arrival', 'task-topline', 'where-toggle', 'task-body', 'task-form', 'task-where',
  'release-btn', 'release-confirm',
  'where', 'where-title', 'where-note', 'where-list', 'where-step', 'where-icon', 'where-name', 'where-state',
  'where-done', 'where-current', 'where-active', 'where-problem', 'where-todo',
]

function rule(css: string, sel: string): string {
  const at = css.indexOf(`${sel} {`)
  expect(at, sel).toBeGreaterThanOrEqual(0)
  return css.slice(at, css.indexOf('}', at))
}

describe('task screen styles (spec §5.4, §5.6, §4)', () => {
  it('styles every class the task screen renders', () => {
    const missing = CLASSES.filter((c) => !new RegExp(`\\.${c}(?![\\w-])`).test(pilot))
    expect(missing).toEqual([])
  })

  it("the form's bottom bar (its button) stays on screen; the toasts sit under the top bar", () => {
    const bar = rule(pilot, '.task-screen .tfk-footer')
    expect(bar).toMatch(/position:\s*sticky/)
    expect(bar).toMatch(/bottom:\s*0/)
    expect(bar).toMatch(/background:/)
    const toasts = rule(pilot, '.toast-region')
    expect(toasts).toMatch(/top:/)
    expect(toasts).not.toMatch(/bottom:/)
  })

  it('a long "Where you are" list scrolls on its own, not the whole task (user 2026-11-10)', () => {
    const at = pilot.lastIndexOf('.task-where {')
    const where = pilot.slice(at, pilot.indexOf('}', at))
    expect(where).toMatch(/position:\s*sticky/)
    expect(where).toMatch(/align-self:\s*start/)
    expect(where).toMatch(/max-height:\s*calc\(100cqh/)
    expect(where).toMatch(/overflow-y:\s*auto/)
    // 100cqh is the pane's height only because the pane is a size container.
    expect(rule(frame, '.work-panes')).toMatch(/container-type:\s*size/)
  })

  it('Release sits at the right of the "Where you are" line (user ruling 2026-11-10)', () => {
    expect(rule(pilot, '.task-topline')).toMatch(/display:\s*flex/)
    expect(rule(pilot, '.task-topline .release-btn')).toContain('margin-left: auto')
    expect(rule(pilot, '.task-topline .release-btn')).toContain('min-height: var(--pilot-touch-min)')
    // Pilot draws no button bar of its own any more.
    expect(pilot).not.toMatch(/\.task-actions(?![\w-])/)
    expect(pilot).not.toMatch(/\.task-primary(?![\w-])/)
  })

  it('forms are capped at 960 px, the side panel joins from 1280 px, and the context bar can flash', () => {
    expect(rule(pilot, '.task-body')).toContain('var(--pilot-form-max)')
    expect(pilot).toContain('@media (min-width: 1280px)')
    expect(frame).toMatch(/\.context-bar-arrived(?![\w-])/)
  })

  it('a focused field never scrolls in under the sticky footer (final review)', () => {
    expect(rule(frame, '.work-panes')).toMatch(/scroll-padding-bottom:/)
  })
})
