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
import { tokensToSpans, spansToTokens, contentPreviewText } from '../param-tokens'

describe('param token serialization', () => {
  it('round-trips: {{Name}} -> span -> {{Name}}, marks untouched', () => {
    const stored = '<p>Lot <strong>{{Lot}}</strong> and <em>{{Op}}</em></p>'
    const editor = tokensToSpans(stored)
    expect(editor).toBe(
      '<p>Lot <strong><span data-param-token="Lot">{{Lot}}</span></strong> and <em><span data-param-token="Op">{{Op}}</span></em></p>',
    )
    expect(spansToTokens(editor)).toBe(stored)
  })

  it('spansToTokens tolerates extra attributes TipTap adds to the chip span', () => {
    expect(spansToTokens('<span class="tfk-param-chip" data-param-token="Batch">{{Batch}}</span>')).toBe('{{Batch}}')
    expect(spansToTokens('<span data-param-token="Batch" contenteditable="false"></span>')).toBe('{{Batch}}')
  })

  it('round-trips a param name containing &: {{Q&A}} -> span (entity-encoded attr + text) -> {{Q&A}}', () => {
    const stored = '{{Q&A}}'
    const editor = tokensToSpans(stored)
    expect(editor).toBe('<span data-param-token="Q&amp;A">{{Q&amp;A}}</span>')
    expect(spansToTokens(editor)).toBe(stored)
  })

  it('round-trips a param name containing <: {{A<B}} text run is escaped, no bogus tag opens', () => {
    const stored = 'Hello {{A<B}} World'
    const editor = tokensToSpans(stored)
    expect(editor).toBe('Hello <span data-param-token="A&lt;B">{{A&lt;B}}</span> World')
    // The span's text portion must not contain a raw `<` — otherwise it opens a bogus tag.
    const spanText = editor.match(/<span[^>]*>([^<]*)<\/span>/)?.[1] ?? ''
    expect(spanText).toBe('{{A&lt;B}}')
    expect(spanText.includes('<')).toBe(false)
    expect(spansToTokens(editor)).toBe(stored)
  })

  it('spansToTokens decodes an entity-encoded data-param-token attribute', () => {
    expect(spansToTokens('<span data-param-token="Q&amp;A">{{Q&A}}</span>')).toBe('{{Q&A}}')
  })

  it('plain legacy content passes through both directions unchanged', () => {
    expect(tokensToSpans('just words')).toBe('just words')
    expect(spansToTokens('<p>just <strong>words</strong></p>')).toBe('<p>just <strong>words</strong></p>')
  })

  it('contentPreviewText strips tags, renders tokens verbatim, collapses whitespace, caps at 120 chars', () => {
    expect(contentPreviewText('<p>Lot  <strong>{{Lot}}</strong>\n done</p>')).toBe('Lot {{Lot}} done')
    expect(contentPreviewText('x'.repeat(200))).toHaveLength(121) // 120 + ellipsis
    expect(contentPreviewText('x'.repeat(200)).endsWith('…')).toBe(true)
  })
})

describe('contentPreviewText entity decoding (deferred minor M5)', () => {
  it('decodes basic entities after stripping tags, &amp; last so no double-decode', () => {
    expect(contentPreviewText('<p>Tom &amp; Jerry &lt;3 &quot;quoted&quot;&nbsp;&#39;s</p>')).toBe(
      'Tom & Jerry <3 "quoted" \'s',
    )
    // An authored literal "&amp;lt;" must render as "&lt;", never double-decode into "<".
    expect(contentPreviewText('&amp;lt;')).toBe('&lt;')
  })
})
