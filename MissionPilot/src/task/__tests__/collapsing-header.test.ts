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
import { keyboardUp, nextOffset } from '../collapsing-header'

describe('nextOffset', () => {
  it('slides out by the scrolled distance', () => {
    expect(nextOffset(0, 30, 92, 30)).toBe(30)
  })
  it('never goes past the header height', () => {
    expect(nextOffset(80, 30, 92, 200)).toBe(92)
  })
  it('comes back on a scroll down', () => {
    expect(nextOffset(50, -20, 92, 300)).toBe(30)
  })
  it('is fully shown at the top', () => {
    expect(nextOffset(60, 10, 92, 0)).toBe(0)
  })
  it('never goes below zero', () => {
    expect(nextOffset(10, -50, 92, 100)).toBe(0)
  })
})

describe('keyboardUp', () => {
  it('is up when the visual viewport is well below the layout viewport', () => {
    expect(keyboardUp(800, 500)).toBe(true)
  })
  it('is down for a small difference', () => {
    expect(keyboardUp(800, 700)).toBe(false)
  })
})
