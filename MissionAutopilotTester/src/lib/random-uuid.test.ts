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
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUuid } from './random-uuid'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('randomUuid', () => {
  const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  afterEach(() => vi.unstubAllGlobals())

  it('returns a version 4 UUID on plain http, where crypto.randomUUID does not exist', () => {
    const real = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) })

    expect(randomUuid()).toMatch(V4)
  })

  it('returns a different value each time on plain http', () => {
    const real = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) })

    const seen = new Set(Array.from({ length: 1000 }, () => randomUuid()))

    expect(seen.size).toBe(1000)
  })

  it('uses the browser function when it exists', () => {
    const real = globalThis.crypto
    const native = '11111111-1111-4111-8111-111111111111'
    vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real), randomUUID: () => native })

    expect(randomUuid()).toBe(native)
  })
})


function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'server' || entry.name === '__tests__' ? [] : sourceFiles(full)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : []
  })
}

describe('browser code', () => {
  it('never calls crypto.randomUUID directly, because plain http does not have it', () => {
    const helper = path.join(SRC, 'lib', 'random-uuid.ts')
    const offenders = sourceFiles(SRC).filter(
      (file) => file !== helper && /crypto\.randomUUID/.test(readFileSync(file, 'utf8')),
    )

    expect(offenders.map((file) => path.relative(SRC, file))).toEqual([])
  })
})
