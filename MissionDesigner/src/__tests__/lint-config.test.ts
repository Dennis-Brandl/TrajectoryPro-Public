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
// @ts-expect-error - eslint.config.js has no .d.ts; runtime import only
import config from '../../eslint.config.js'

describe('eslint-config: cutover lint rules are wired in', () => {
  it('has at least one config block enabling cutover/no-sensitive-table-imports as error', () => {
    // The exported config is an array of flat-config objects.
    const blocks = Array.isArray(config) ? config : [config]
    const matched = blocks.find((block) => {
      if (!block || typeof block !== 'object') return false
      const rules = (block as { rules?: Record<string, unknown> }).rules
      return rules && rules['cutover/no-sensitive-table-imports'] === 'error'
    })
    expect(matched).toBeDefined()
  })

  it('the cutover plugin namespace is registered with the rule object', () => {
    const blocks = Array.isArray(config) ? config : [config]
    const withPlugin = blocks.find((block) => {
      const plugins = (block as { plugins?: Record<string, { rules?: Record<string, unknown> }> }).plugins
      return plugins && plugins.cutover && plugins.cutover.rules?.['no-sensitive-table-imports']
    })
    expect(withPlugin).toBeDefined()
  })
})
