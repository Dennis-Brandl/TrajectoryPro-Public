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
import { describe, expect, it } from 'vitest'
import type { FormDocument } from '@mission/form-schema'
import { renderFormDocumentGrid } from '../pdf-step-pages'

type Op = { fn: string; args: unknown[] }
function makeDoc() {
  const ops: Op[] = []
  const rec =
    (fn: string) =>
    (...args: unknown[]) => {
      ops.push({ fn, args })
    }
  const doc = {
    setFontSize: rec('setFontSize'),
    setTextColor: rec('setTextColor'),
    setFont: rec('setFont'),
    setDrawColor: rec('setDrawColor'),
    setFillColor: rec('setFillColor'),
    setLineWidth: rec('setLineWidth'),
    text: rec('text'),
    rect: rec('rect'),
    line: rec('line'),
    roundedRect: rec('roundedRect'),
    addImage: rec('addImage'),
    addPage: rec('addPage'),
    // A real (if crude) character-based wrap, not the identity `[t]`: finding-2's box-growth
    // test needs a long `meaning` to actually produce more than one line at a given width.
    splitTextToSize: (t: string, maxWidth?: number) => {
      const width = typeof maxWidth === 'number' ? maxWidth : 1000
      const charsPerLine = Math.max(20, Math.floor(width / 3))
      const lines: string[] = []
      for (let i = 0; i < t.length; i += charsPerLine) lines.push(t.slice(i, i + charsPerLine))
      return lines.length > 0 ? lines : [t]
    },
    internal: { pageSize: { getHeight: () => 297, getWidth: () => 210 } },
  }
  return { doc: doc as never, ops }
}

const twoUp: FormDocument = {
  version: 2,
  sections: [
    {
      id: 'content',
      role: 'content',
      rows: [
        { id: 'r1', blocks: [{ id: 'b0', type: 'header', content: 'Title' }] },
        {
          id: 'r2',
          blocks: [
            { id: 'b1', type: 'textInput', fieldName: 'f1', label: 'Left', layout: { span: { base: 6 } } },
            { id: 'b2', type: 'textInput', fieldName: 'f2', label: 'Right', layout: { span: { base: 6 } } },
          ],
        },
        {
          id: 'r3',
          blocks: [
            { id: 'b3', type: 'text', content: 'Hidden on tablet', layout: { visible: { base: true, tablet: false } } },
          ],
        },
      ],
    },
    {
      id: 'footer',
      role: 'footer',
      rows: [{ id: 'rf', blocks: [{ id: 'b4', type: 'button', label: 'Go', outputValue: 'go' }] }],
    },
  ],
}

describe('renderFormDocumentGrid', () => {
  it('lays a 6/6 row side-by-side at half grid width each', () => {
    const { doc, ops } = makeDoc()
    renderFormDocumentGrid(doc, twoUp, undefined, 40)
    const labels = ops.filter((o) => o.fn === 'text' && (o.args[0] === 'Left' || o.args[0] === 'Right'))
    expect(labels).toHaveLength(2)
    const [lx, rx] = labels.map((o) => o.args[1] as number)
    expect(rx).toBeGreaterThan(lx)
    const underlines = ops.filter((o) => o.fn === 'line')
    expect(underlines.length).toBeGreaterThanOrEqual(2)
  })
  it('skips blocks hidden at tablet (resolveAt cascade)', () => {
    const { doc, ops } = makeDoc()
    renderFormDocumentGrid(doc, twoUp, undefined, 40)
    expect(ops.some((o) => o.fn === 'text' && o.args[0] === 'Hidden on tablet')).toBe(false)
  })
  it('renders the footer button after content and returns an advanced y', () => {
    const { doc, ops } = makeDoc()
    const y = renderFormDocumentGrid(doc, twoUp, undefined, 40)
    expect(ops.some((o) => o.fn === 'roundedRect')).toBe(true)
    expect(y).toBeGreaterThan(40)
  })
  it('renders an e-signature block: label, role, and the different-user notice', () => {
    const { doc, ops } = makeDoc()
    const withEsig: FormDocument = {
      version: 2,
      sections: [
        {
          id: 'c',
          role: 'content',
          rows: [
            {
              id: 'r',
              blocks: [
                {
                  id: 'e1',
                  type: 'esignature',
                  fieldName: 'approval',
                  label: 'Approve',
                  meaning: 'I approve',
                  roleName: 'QA Lead',
                  requireDifferentUser: true,
                },
              ],
            },
          ],
        },
      ],
    }
    renderFormDocumentGrid(doc, withEsig, undefined, 40)
    const texts = ops.filter((o) => o.fn === 'text').map((o) => o.args[0])
    expect(texts).toContain('Approve')
    expect(texts).toContain('Role: QA Lead')
    expect(texts).toContain('Requires a different user than the operator')
  })

  it('renders an e-signature block with no role as "any work-center member"', () => {
    const { doc, ops } = makeDoc()
    const withEsig: FormDocument = {
      version: 2,
      sections: [
        {
          id: 'c',
          role: 'content',
          rows: [{ id: 'r', blocks: [{ id: 'e1', type: 'esignature', fieldName: 'approval' }] }],
        },
      ],
    }
    renderFormDocumentGrid(doc, withEsig, undefined, 40)
    const texts = ops.filter((o) => o.fn === 'text').map((o) => o.args[0])
    expect(texts).toContain('Role: any work-center member')
  })

  it('grows the box for a long meaning and keeps the border enclosing all its text (fix round 1, finding 2)', () => {
    const esigDoc = (meaning: string): FormDocument => ({
      version: 2,
      sections: [
        {
          id: 'c',
          role: 'content',
          rows: [{ id: 'r', blocks: [{ id: 'e1', type: 'esignature', fieldName: 'approval', meaning }] }],
        },
      ],
    })

    // renderFormDocumentGrid draws TWO outer grid-frame rects (a filled background, then a
    // border) before any per-block content; with exactly one block in this document, the
    // LAST `rect` op recorded is always that block's own bordered box (drawn inside
    // renderFormBlock's 'esignature' case), never the outer frame — fix round 2, finding 1
    // (`.find` previously grabbed the outer frame rect by mistake, making the enclosure
    // assertions below vacuous).
    const short = makeDoc()
    renderFormDocumentGrid(short.doc, esigDoc('I approve'), undefined, 40)
    const shortRects = short.ops.filter((o) => o.fn === 'rect')
    expect(shortRects.length).toBe(3) // 2 outer frame rects + this block's own box
    const shortHeight = shortRects[shortRects.length - 1].args[3] as number

    const long = makeDoc()
    const longMeaning = 'A'.repeat(200)
    renderFormDocumentGrid(long.doc, esigDoc(longMeaning), undefined, 40)
    const longRects = long.ops.filter((o) => o.fn === 'rect')
    expect(longRects.length).toBe(3)
    const blockRect = longRects[longRects.length - 1]
    const [rectX, rectY, , rectH] = blockRect.args as number[]
    const longHeight = rectH

    expect(longHeight).toBeGreaterThan(shortHeight)

    // Every text line drawn inside THIS block (at the block's own x = pdfX + 2, not the
    // outer frame's x) must land inside its rectangle, and so must the signature line —
    // nothing overflows the border.
    const blockTextX = rectX + 2
    const textYs = long.ops.filter((o) => o.fn === 'text' && o.args[1] === blockTextX).map((o) => o.args[2] as number)
    expect(textYs.length).toBeGreaterThan(0) // guards against the filter matching nothing
    for (const y of textYs) {
      expect(y).toBeGreaterThanOrEqual(rectY)
      expect(y).toBeLessThanOrEqual(rectY + rectH)
    }
    const signatureLines = long.ops.filter((o) => o.fn === 'line')
    const signatureLine = signatureLines[signatureLines.length - 1]
    const signatureLineY = signatureLine.args[1] as number
    expect(signatureLineY).toBeGreaterThanOrEqual(rectY)
    expect(signatureLineY).toBeLessThanOrEqual(rectY + rectH)
  })

  it('image blocks without bundled bytes draw the placeholder, never addImage', () => {
    const { doc, ops } = makeDoc()
    const withImg: FormDocument = {
      version: 2,
      sections: [
        {
          id: 'c',
          role: 'content',
          rows: [
            {
              id: 'r',
              blocks: [
                { id: 'i1', type: 'image', src: 'No image selected', imageOid: 'X', layout: { aspectRatio: '16/9' } },
              ],
            },
          ],
        },
      ],
    }
    renderFormDocumentGrid(doc, withImg, new Map(), 40)
    expect(ops.some((o) => o.fn === 'addImage')).toBe(false)
    expect(ops.some((o) => o.fn === 'text' && o.args[0] === 'Image')).toBe(true)
  })
})

describe('renderFormDocumentGrid: job buttons and per-device size', () => {
  const oneBlock = (block: Record<string, unknown>): FormDocument =>
    ({ version: 2, sections: [{ id: 's', role: 'content', rows: [{ id: 'r', blocks: [block] }] }] }) as never

  it('prints the step continue label on an empty-label Continue button', () => {
    const { doc, ops } = makeDoc()
    const d = oneBlock({ id: 'b', type: 'button', job: 'continue', label: '', outputValue: 'continue' })
    renderFormDocumentGrid(doc, d, undefined, 40, {
      nodeType: 'userInteractionStep',
      data: { uiParameters: [{ type: 'Button', value: 'Next step' }] } as never,
    })
    expect(ops.some((o) => o.fn === 'text' && o.args[0] === 'Next step')).toBe(true)
  })
  it('prints Continue when the step has no label', () => {
    const { doc, ops } = makeDoc()
    const d = oneBlock({ id: 'b', type: 'button', job: 'continue', outputValue: 'continue' })
    renderFormDocumentGrid(doc, d, undefined, 40, { nodeType: 'userInteractionStep', data: {} as never })
    expect(ops.some((o) => o.fn === 'text' && o.args[0] === 'Continue')).toBe(true)
  })
  it('prints the step yes label on an empty-label Yes button of a Yes/No step', () => {
    const { doc, ops } = makeDoc()
    const d = oneBlock({ id: 'b', type: 'button', job: 'yes', label: '', outputValue: 'true' })
    renderFormDocumentGrid(doc, d, undefined, 40, {
      nodeType: 'yesNoStep',
      data: { uiParameters: [{ type: 'YesNoButtons', value: 'Approve', value2: 'Reject' }] } as never,
    })
    expect(ops.some((o) => o.fn === 'text' && o.args[0] === 'Approve')).toBe(true)
  })
  it('keeps a typed label over the step label', () => {
    const { doc, ops } = makeDoc()
    const d = oneBlock({ id: 'b', type: 'button', job: 'yes', label: 'Go', outputValue: 'true' })
    renderFormDocumentGrid(doc, d, undefined, 40, { nodeType: 'yesNoStep', data: {} as never })
    expect(ops.some((o) => o.fn === 'text' && o.args[0] === 'Go')).toBe(true)
  })
  it('prints the Desktop size when a phone override exists', () => {
    const { doc, ops } = makeDoc()
    const d = oneBlock({ id: 'b', type: 'text', content: 'Hello', size: 'lg', sizeAt: { phone: 'xs' } })
    renderFormDocumentGrid(doc, d, undefined, 40)
    const i = ops.findIndex(
      (o) => o.fn === 'text' && Array.isArray(o.args[0]) && (o.args[0] as string[])[0] === 'Hello',
    )
    expect(i).toBeGreaterThan(0)
    expect(
      ops
        .slice(0, i)
        .filter((o) => o.fn === 'setFontSize')
        .pop()?.args[0],
    ).toBe(8)
  })
})
