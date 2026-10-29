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
import { resolveImageSrc } from '../useImageResolver'

describe('resolveImageSrc', () => {
  const images = { 'logo.png': 'data:image/png;base64,AAA' }
  it('passes http(s) through unchanged', () => {
    expect(resolveImageSrc('https://x/y.png', images)).toBe('https://x/y.png')
  })
  it('resolves a filename key from the images map', () => {
    expect(resolveImageSrc('logo.png', images)).toBe('data:image/png;base64,AAA')
  })
  it('returns undefined for an unknown key', () => {
    expect(resolveImageSrc('missing.png', images)).toBeUndefined()
  })
})
