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
import { clusterRows } from '../convert/cluster-rows'
import type { V1Element } from '../convert/v1-types'

const el = (id: string, x: number, y: number, w = 100, h = 40): V1Element => ({ id, type: 'text', x, y, width: w, height: h })
const ids = (rows: V1Element[][]) => rows.map((r) => r.map((e) => e.id))

describe('clusterRows (runtime port)', () => {
  it('groups elements sharing a Y band into one row, sorted left-to-right', () => {
    // b is left of a but lower in the list; same Y band => one row, x-sorted => [b, a]
    const rows = clusterRows([el('a', 300, 0), el('b', 0, 5)])
    expect(ids(rows)).toEqual([['b', 'a']])
  })

  it('separates elements whose vertical overlap is below 30%', () => {
    // a: y 0..40; b: y 36..76 => overlap 4 / min(40,40)=0.1 < 0.3 => two rows
    const rows = clusterRows([el('a', 0, 0), el('b', 0, 36)])
    expect(ids(rows)).toEqual([['a'], ['b']])
  })

  it('emits rows top-to-bottom regardless of input order', () => {
    const rows = clusterRows([el('low', 0, 200), el('high', 0, 0)])
    expect(ids(rows)).toEqual([['high'], ['low']])
  })

  it('uses the SHORTER of the two heights as the overlap denominator', () => {
    // tall a: y 0..100; short b: y 80..110 (h 30). overlap = 20; min height = 30; 20/30=0.66 >= 0.3 => same row
    const rows = clusterRows([el('a', 0, 0, 100, 100), el('b', 200, 80, 100, 30)])
    expect(ids(rows)).toEqual([['a', 'b']])
  })

  it('is single-linkage: joins the first group any member overlaps', () => {
    // a and c both overlap b's band but not each other; b created first, a and c both join it
    const rows = clusterRows([el('b', 0, 20, 100, 40), el('a', 200, 0, 100, 40), el('c', 400, 40, 100, 40)])
    // a: 0..40, b: 20..60 overlap 20/40=0.5; c: 40..80, b overlap 20/40=0.5 => all one row.
    // Final order is x-sorted, so b(x=0), a(x=200), c(x=400).
    expect(ids(rows)).toEqual([['b', 'a', 'c']])
  })
})
