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
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Node renderers must never animate a handle's position.
 *
 * A notation switch moves handles (BPMN: left/right; flowchart and ISA 88:
 * top/bottom). React Flow measures handle positions right after the switch and
 * caches them; with `transition-all` the handle was still at its old place when
 * measured, so connection lines ended beside the handles and the handles could
 * not be reconnected. Plain `transition` animates colour, shadow and scale only.
 */
describe('node renderer handles', () => {
  const dir = path.resolve(__dirname, '..')
  const files = readdirSync(dir).filter((f) => f.endsWith('.tsx'))

  it('finds the renderer files', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it.each(files)('%s does not use transition-all', (file) => {
    expect(readFileSync(path.join(dir, file), 'utf8')).not.toMatch(/\btransition-all\b/)
  })
})
