// @vitest-environment node
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
// Deliberately in its own file: this pragma must be `node`, while the sanitizer's
// behavioural tests in blocks-text.test.tsx need `jsdom`.
import { describe, it, expect } from 'vitest'
import { sanitizeHtml } from '../sanitize'

describe('sanitizeHtml outside a DOM', () => {
  it('throws rather than echoing the payload back', () => {
    // dompurify sets isSupported = false when there is no window.document and then
    // returns the input untouched ("Return dirty HTML if DOMPurify cannot run").
    // The single sanctioned sink feeds dangerouslySetInnerHTML, so degrading to an
    // identity function is a security invariant failing open, and silently. Fail loud.
    expect(() => sanitizeHtml('<img src=x onerror=alert(1)>')).toThrow(/sanitizeHtml requires a DOM/)
  })
})
