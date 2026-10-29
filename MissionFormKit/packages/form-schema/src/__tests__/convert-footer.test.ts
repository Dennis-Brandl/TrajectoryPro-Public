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
import { isButtonRow, splitTrailingButtonRows, classifyFooter } from '../convert/footer'
import type { V1Element } from '../convert/v1-types'
import type { ConversionEntry } from '../convert/report'

const btn = (id: string, o: Partial<V1Element>): V1Element => ({ id, type: 'button', x: 0, y: 0, width: 120, height: 44, label: id, outputValue: id, ...o })
const txt = (id: string): V1Element => ({ id, type: 'text', x: 0, y: 0, width: 100, height: 20 })

describe('footer classification', () => {
  it('recognizes an all-button row', () => {
    expect(isButtonRow([btn('a', {}), btn('b', {})])).toBe(true)
    expect(isButtonRow([btn('a', {}), txt('t')])).toBe(false)
  })

  it('splits trailing all-button rows off the content rows', () => {
    const rows = [[txt('h')], [btn('a', {})], [btn('b', {}), btn('c', {})]]
    const { contentRows, trailingButtons } = splitTrailingButtonRows(rows)
    expect(contentRows).toEqual([[txt('h')]])
    expect(trailingButtons.map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('drops a lone default Continue button', () => {
    const entries: ConversionEntry[] = []
    const kept = classifyFooter([btn('c', { label: 'Continue', outputValue: 'continue', deletable: false })], entries)
    expect(kept).toEqual([])
    expect(entries.filter((e) => e.kind === 'droppedDefaultButton')).toHaveLength(1)
  })

  it('drops a Yes/No pair and preserves both labels', () => {
    const entries: ConversionEntry[] = []
    const kept = classifyFooter([btn('y', { label: 'Approve', outputValue: 'true', deletable: false }), btn('n', { label: 'Reject', outputValue: 'false', deletable: false })], entries)
    expect(kept).toEqual([])
    const e = entries.find((x) => x.kind === 'droppedYesNoButtons')!
    expect(e.detail).toContain('Approve')
    expect(e.detail).toContain('Reject')
  })

  it('keeps custom authored action buttons', () => {
    const entries: ConversionEntry[] = []
    const kept = classifyFooter([btn('save', { label: 'Save', outputValue: 'save' })], entries)
    expect(kept.map((e) => e.id)).toEqual(['save'])
    expect(entries).toEqual([])
  })

  it('does not treat a deletable continue-labelled button as the protected default', () => {
    const entries: ConversionEntry[] = []
    // deletable !== false => a user-added button that merely happens to say Continue; keep it
    const kept = classifyFooter([btn('c', { label: 'Continue', outputValue: 'continue' })], entries)
    expect(kept.map((e) => e.id)).toEqual(['c'])
  })
})
