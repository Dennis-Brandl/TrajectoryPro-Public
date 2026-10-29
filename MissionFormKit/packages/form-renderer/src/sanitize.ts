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
import DOMPurify from 'dompurify'

/**
 * The single sanctioned HTML sink for authored rich-text content.
 * Everything rendered via dangerouslySetInnerHTML MUST pass through here.
 */
export function sanitizeHtml(html: string): string {
  // dompurify reports isSupported = false both when there is no window.document at all
  // and when the DOM it found is too degraded to sanitize with. In the latter case
  // `sanitize` still exists and quietly returns its input untouched ("Return dirty HTML
  // if DOMPurify cannot run"), which would hand unsanitized markup straight to
  // dangerouslySetInnerHTML. A security control that fails open must not fail silently.
  if (!DOMPurify.isSupported) {
    throw new Error('sanitizeHtml requires a DOM: refusing to pass unsanitized HTML through')
  }
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
}
