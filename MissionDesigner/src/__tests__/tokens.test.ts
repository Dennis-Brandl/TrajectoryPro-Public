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

const dist = (name: string) => readFileSync(resolve(__dirname, '../../packages/tokens/dist', name), 'utf8')

describe('shared tokens', () => {
  const dark = dist('tokens.dark.css')
  const light = dist('tokens.light.css')

  it('uses brand blue for the focus ring', () => {
    expect(dark).toMatch(/--ring: #007aff/)
    expect(light).toMatch(/--ring: #007aff/)
  })

  it('defines selection and link colors', () => {
    expect(dark).toMatch(/--selection: rgb\(0 122 255 \/ 18%\)/)
    expect(light).toMatch(/--selection: rgb\(0 122 255 \/ 12%\)/)
    expect(dark).toMatch(/--link: #60a5fa/)
    expect(light).toMatch(/--link: #0060cc/)
  })

  it('defines status colors', () => {
    expect(dark).toMatch(/--status-ok-bg: #052e16/)
    expect(light).toMatch(/--status-alarm-fg: #7f1d1d/)
  })
})
