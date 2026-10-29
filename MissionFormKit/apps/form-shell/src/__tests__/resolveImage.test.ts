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
import { resolveImage } from '../resolveImage'

describe('resolveImage', () => {
  it('returns a data URI for a known sample key', () => {
    const uri = resolveImage('pump.jpg')
    expect(uri).toBeTruthy()
    expect(uri!.startsWith('data:image/svg+xml')).toBe(true)
  })

  it('returns undefined for an unknown key', () => {
    expect(resolveImage('nope.png')).toBeUndefined()
  })

  it('returns undefined for inherited Object.prototype keys', () => {
    expect(resolveImage('toString')).toBeUndefined()
    expect(resolveImage('constructor')).toBeUndefined()
    expect(resolveImage('__proto__')).toBeUndefined()
  })
})
