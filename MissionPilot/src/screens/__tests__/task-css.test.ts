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
  'task-heading', 'task-arrival', 'where-toggle', 'task-body', 'task-form', 'task-where',
  'task-actions', 'task-status', 'task-missing', 'task-missing-fields', 'task-waiting', 'task-ready',
  'task-actions-compact', 'task-owns-buttons', 'link-btn', 'task-buttons', 'task-primary', 'release-btn', 'release-confirm',
  'where', 'where-title', 'where-note', 'where-list', 'where-step', 'where-icon', 'where-name', 'where-state',
  'where-done', 'where-current', 'where-active', 'where-problem', 'where-todo', 'toast-ok',
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

  it('the action footer stays on screen and the toasts sit clear of it, under the top bar', () => {
    const footer = rule(pilot, '.task-actions')
    expect(footer).toMatch(/position:\s*sticky/)
    expect(footer).toMatch(/bottom:\s*0/)
    const toasts = rule(pilot, '.toast-region')
    expect(toasts).toMatch(/top:/)
    expect(toasts).not.toMatch(/bottom:/)
  })

  it("a form that owns its buttons: its bottom bar pins just above a compact strip (spec 2026-10-28 §5.2)", () => {
    const bar = rule(pilot, '.task-owns-buttons .tfk-footer')
    expect(bar).toMatch(/position:\s*sticky/)
    expect(bar).toContain('bottom: var(--task-actions-h')
    expect(bar).toMatch(/background:/)
    const compact = rule(pilot, '.task-actions-compact')
    expect(compact).toContain('padding-block: var(--pilot-space-1)')
    // One line even on a phone: status and Release share the row; long status text wraps in its column.
    expect(compact).toContain('flex-wrap: nowrap')
    // Smaller than the full strip's 3.5 rem Release, never below the 44 px touch floor.
    expect(rule(pilot, '.task-actions-compact .release-btn')).toContain('min-height: var(--pilot-touch-min)')
    expect(rule(pilot, '.task-actions-compact .task-status')).toContain('font-size: var(--pilot-text-sm)')
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
