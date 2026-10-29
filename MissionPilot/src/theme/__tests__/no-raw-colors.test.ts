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
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')
// The token sheet holds the raw values AND the FormKit bridge (spec §6.1 exemption).
const EXEMPT = new Set([join('theme', 'tokens.css')])
// Reads (never sets) the bridged --form-color-surface to hand FormKit its own surface for
// the authored-colour guard (spec §14). Exempt from the --form-* check only.
const FORM_TOKEN_READERS = new Set([join('theme', 'form-surface.ts')])

function sourceFiles(): string[] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .filter((p) => /\.(css|ts|tsx)$/.test(p))
    .filter((p) => !p.split(/[\\/]/).includes('__tests__'))
    .filter((p) => !EXEMPT.has(p))
}

function offenders(pattern: RegExp, skip: ReadonlySet<string> = new Set()): string[] {
  return sourceFiles().filter((p) => !skip.has(p)).flatMap((p) =>
    readFileSync(join(SRC, p), 'utf8')
      .split('\n')
      .map((line, i) => (pattern.test(line) ? `${p}:${i + 1}: ${line.trim()}` : null))
      .filter((x): x is string => x !== null),
  )
}

describe('static gate (spec §6.1, §18)', () => {
  it('no hex colour outside the token sheet', () => {
    expect(offenders(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/)).toEqual([])
  })

  it('no --form-* token name outside the token sheet (the bridge sets them; nothing else reads them)', () => {
    expect(offenders(/--form-/, FORM_TOKEN_READERS)).toEqual([])
  })

  it('keyboard focus is an outline, so selected-state box-shadows cannot erase it (WCAG 2.4.7)', () => {
    const css = readFileSync(join(SRC, 'pilot.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const rule = (sel: string) => {
      const at = css.indexOf(`${sel} {`)
      expect(at, sel).toBeGreaterThanOrEqual(0)
      return css.slice(at, css.indexOf('}', at))
    }
    const base = rule(':focus-visible')
    expect(base).toMatch(/outline:\s*2px solid var\(--pilot-focus\)/)
    expect(base).not.toMatch(/box-shadow/)
    // Tabs and chips sit in overflow-x scrollers, which clip an outside outline.
    expect(rule(".work-tabs [role='tab']:focus-visible")).toMatch(/outline-offset:\s*-/)
    expect(rule('.wf-chip:focus-visible')).toMatch(/outline-offset:\s*-/)
  })

  it('chrome base styles never reach into embedded FormKit forms', () => {
    const css = readFileSync(join(SRC, 'pilot.css'), 'utf8')
    // Every bare element rule must exclude .tfk-viewport descendants. The capture
    // allows one nested (...) group so it reads past the :not(...) it checks for.
    const bare = [...css.matchAll(/:where\(((?:button|select|h1|h2)(?:[^()]|\([^()]*\))*)\)/g)].map((m) => m[1]!)
    expect(bare.length).toBeGreaterThan(0)
    for (const sel of bare) expect(sel).toContain(':not(.tfk-viewport *)')
  })
})
