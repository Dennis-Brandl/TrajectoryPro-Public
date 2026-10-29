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
import { useLayoutEffect, useState, type RefObject } from 'react'

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}
export interface BlockRect {
  id: string
  rect: Rect
}
export interface RowRect {
  id: string
  rect: Rect
  blocks: BlockRect[]
}
export interface SectionRect {
  id: string
  role: string
  rect: Rect
  rows: RowRect[]
}
export interface RectMap {
  sections: SectionRect[]
}

/** Read the renderer's rendered geometry into a host-relative map. Pure: exported for tests.
 *  Relies only on the renderer's edit-mode DOM contract (data-section-id/-role/-row-id/-block-id). */
export function buildRectMap(host: HTMLElement): RectMap {
  const hostBox = host.getBoundingClientRect()
  const rel = (el: Element): Rect => {
    const b = el.getBoundingClientRect()
    return { left: b.left - hostBox.left, top: b.top - hostBox.top, width: b.width, height: b.height }
  }
  const sections = Array.from(host.querySelectorAll<HTMLElement>('[data-section-id]')).map((sEl) => ({
    id: sEl.getAttribute('data-section-id') ?? '',
    role: sEl.getAttribute('data-section-role') ?? 'content',
    rect: rel(sEl),
    rows: Array.from(sEl.querySelectorAll<HTMLElement>('[data-row-id]')).map((rEl) => ({
      id: rEl.getAttribute('data-row-id') ?? '',
      rect: rel(rEl),
      blocks: Array.from(rEl.querySelectorAll<HTMLElement>('[data-block-id]')).map((bEl) => ({
        id: bEl.getAttribute('data-block-id') ?? '',
        rect: rel(bEl),
      })),
    })),
  }))
  return { sections }
}

/** Host-relative rect map for every section/row/block, rebuilt on `deps` change and on host resize
 *  (the document is frozen during a drag, so only scroll/resize move rects mid-drag). */
export function useRectMap(hostRef: RefObject<HTMLElement | null>, deps: unknown[]): RectMap {
  const [map, setMap] = useState<RectMap>({ sections: [] })
  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const update = () => setMap(buildRectMap(host))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(host)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostRef, ...deps])
  return map
}
