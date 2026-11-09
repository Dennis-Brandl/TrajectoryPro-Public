/*
 * Copyright 2026 Dennis L. Brandl
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// A native select's open list is drawn by the browser and never reaches the DOM,
// so no component test can see it. Edge, Opera and Chrome paint the list white
// under a bg-transparent select while the options inherit its text color, which
// in the dark theme is white on white. index.css must color the options itself.
describe('native select option colors', () => {
  const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8')

  it('gives options an opaque themed background and matching text', () => {
    const rule = css.match(/option,\s*optgroup\s*\{([^}]*)\}/)
    expect(rule).not.toBeNull()
    expect(rule![1]).toMatch(/@apply[^;]*\bbg-popover\b/)
    expect(rule![1]).toMatch(/@apply[^;]*\btext-popover-foreground\b/)
  })
})
