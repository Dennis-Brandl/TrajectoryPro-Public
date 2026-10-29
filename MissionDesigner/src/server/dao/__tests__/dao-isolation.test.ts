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

// @vitest-environment node

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const SRC = 'src'
const FORBIDDEN = /['"]([^'"]*_sensitiveTables|[^'"]*_rawSchema)['"]/
const ALLOWED_RE = [
  /^src[\\/]server[\\/]dao[\\/]/,
  /^src[\\/]server[\\/]db[\\/]_sensitiveTables\.ts$/,
  /^src[\\/]server[\\/]db[\\/]_rawSchema\.ts$/,
  /^src[\\/]server[\\/]db[\\/]__tests__[\\/]/,
]

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, acc)
    else if (/\.tsx?$/.test(entry)) acc.push(full)
  }
  return acc
}

describe('DAO isolation (runtime meta-check)', () => {
  it('no file outside the allowlist imports _sensitiveTables or _rawSchema', () => {
    const violations: string[] = []
    for (const file of walk(SRC)) {
      const rel = relative('.', file).replace(/\//g, sep)
      if (ALLOWED_RE.some((re) => re.test(rel))) continue
      const text = readFileSync(file, 'utf8')
      for (const line of text.split(/\r?\n/)) {
        if (/^\s*import\b/.test(line) && FORBIDDEN.test(line)) {
          violations.push(`${rel}: ${line.trim()}`)
        }
      }
    }
    expect(violations).toEqual([])
  })
})
