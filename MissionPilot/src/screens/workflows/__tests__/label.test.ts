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
import { wrapLabel } from '../label'

describe('wrapLabel (spec §5.7: names inside nodes)', () => {
  it('keeps a short name whole on one line', () => {
    expect(wrapLabel('Begin', 15, 2)).toEqual(['Begin'])
  })

  it('wraps on words and ends a name that does not fit with an ellipsis', () => {
    expect(wrapLabel('A Very Long Step Name Indeed', 15, 2)).toEqual(['A Very Long', 'Step Name Inde…'])
  })

  it('one line reproduces the old 20-character truncation', () => {
    expect(wrapLabel('A Very Long Step Name Indeed', 20, 1)).toEqual(['A Very Long Step Na…'])
  })

  it('splits a single unbroken word and never exceeds the line length (Review Focus 4)', () => {
    const lines = wrapLabel('Superlongunbrokenstepnameforthetest', 15, 2)
    expect(lines).toEqual(['Superlongunbrok', 'enstepnamefort…'])
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(15)
  })

  it('the pieces of a hard split count as lines like any other', () => {
    expect(wrapLabel('ab Superlongunbrokenx', 15, 2)).toEqual(['ab', 'Superlongunbro…'])
    expect(wrapLabel('ab cd', 15, 1)).toEqual(['ab cd'])
  })

  it('an empty or blank name is one empty line', () => {
    expect(wrapLabel('', 15, 2)).toEqual([''])
    expect(wrapLabel('   ', 15, 2)).toEqual([''])
  })
})
