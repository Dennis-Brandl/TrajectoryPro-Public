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
import { parseDragId, blockDragId, rowDragId, paletteDragId } from '../dragTypes'

describe('parseDragId', () => {
  it('round-trips block / row / palette ids', () => {
    expect(parseDragId(blockDragId('338311217359618048'))).toEqual({
      kind: 'block',
      id: '338311217359618048',
    })
    expect(parseDragId(rowDragId('r1'))).toEqual({ kind: 'row', id: 'r1' })
    expect(parseDragId(paletteDragId('textInput'))).toEqual({ kind: 'palette', type: 'textInput' })
    expect(parseDragId(paletteDragId('button'))).toEqual({ kind: 'palette', type: 'button' })
  })

  it('rejects an unknown palette block type (stale / garbage id) → null', () => {
    // Guards createDefaultBlock from ever receiving a type its switch cannot build.
    expect(parseDragId('palette:bogus')).toBeNull()
    expect(parseDragId('palette:carousel')).toBeNull()
    expect(parseDragId('palette:')).toBeNull()
  })

  it('returns null for an unrecognised kind', () => {
    expect(parseDragId('mystery:x')).toBeNull()
    expect(parseDragId('')).toBeNull()
  })
})
