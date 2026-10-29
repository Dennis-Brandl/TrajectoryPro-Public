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
import { describe, it, expect, afterEach } from 'vitest'
import { buildRectMap } from '../useRectMap'

// Give an element a fixed screen rect (jsdom returns zeros otherwise).
function stubRect(el: Element, r: { left: number; top: number; width: number; height: number }) {
  el.getBoundingClientRect = () =>
    ({
      left: r.left,
      top: r.top,
      right: r.left + r.width,
      bottom: r.top + r.height,
      width: r.width,
      height: r.height,
      x: r.left,
      y: r.top,
      toJSON: () => ({}),
    }) as DOMRect
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('useRectMap', () => {
  it('buildRectMap computes nested host-relative rects', () => {
    const host = document.createElement('div')
    stubRect(host, { left: 100, top: 50, width: 400, height: 400 })
    const section = document.createElement('section')
    section.setAttribute('data-section-id', 's1')
    section.setAttribute('data-section-role', 'footer')
    stubRect(section, { left: 100, top: 250, width: 400, height: 100 })
    const row = document.createElement('div')
    row.setAttribute('data-row-id', 'r1')
    stubRect(row, { left: 110, top: 260, width: 380, height: 40 })
    const block = document.createElement('div')
    block.setAttribute('data-block-id', 'b1')
    stubRect(block, { left: 300, top: 260, width: 180, height: 40 })
    row.appendChild(block)
    section.appendChild(row)
    host.appendChild(section)

    const map = buildRectMap(host)
    expect(map.sections).toHaveLength(1)
    expect(map.sections[0]).toMatchObject({ id: 's1', role: 'footer' })
    expect(map.sections[0].rect).toEqual({ left: 0, top: 200, width: 400, height: 100 }) // host-relative
    expect(map.sections[0].rows[0].id).toBe('r1')
    expect(map.sections[0].rows[0].blocks[0]).toEqual({
      id: 'b1',
      rect: { left: 200, top: 210, width: 180, height: 40 },
    })
  })
})
