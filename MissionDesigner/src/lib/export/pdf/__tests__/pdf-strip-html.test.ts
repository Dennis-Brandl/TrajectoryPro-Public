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
// Deferred final-review minor M5 (2026-08-11): the PDF's plain-text rendering of WYSIWYG
// text/header content must decode entities and keep paragraph breaks (jsPDF's
// splitTextToSize honors \n).
import { describe, it, expect } from 'vitest'
import { stripHtml } from '../pdf-step-pages'

describe('stripHtml', () => {
  it('decodes basic entities, &amp; last', () => {
    expect(stripHtml('Tom &amp; Jerry &lt;3 &quot;q&quot; &#39;s&nbsp;end')).toBe('Tom & Jerry <3 "q" \'s end')
    expect(stripHtml('&amp;lt;')).toBe('&lt;')
  })

  it('turns paragraph boundaries and <br> into newlines, strips remaining tags', () => {
    expect(stripHtml('<p>one</p><p>two</p>')).toBe('one\ntwo')
    expect(stripHtml('a<br>b<br/>c')).toBe('a\nb\nc')
    expect(stripHtml('<p>just <strong>words</strong></p>')).toBe('just words')
  })
})
