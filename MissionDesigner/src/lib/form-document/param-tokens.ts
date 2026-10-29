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
//
// The stored form of a parameter reference in text/header content is plain {{ParamName}}
// text (spec 2026-08-11 §3.3) — what the runtime substitutes and what legacy consumers
// render harmlessly. The <span data-param-token> form exists ONLY inside the TipTap
// editor (atomic chip node); these two functions convert at the dialog boundary.

const TOKEN_RE = /\{\{([^{}]+)\}\}/g
const CHIP_SPAN_RE = /<span\b[^>]*\bdata-param-token="([^"]*)"[^>]*>[^<]*<\/span>/g

/** Entity-encode a param name for use inside an HTML attribute value. TipTap's getHTML()
 *  entity-encodes attribute values on serialize, so a name like `Q&A` must be pre-encoded
 *  here to match what the round trip through the editor will produce — otherwise
 *  spansToTokens would need to guess whether a captured `&amp;` was authored or encoded. */
function encodeAttrValue(name: string): string {
  return name.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Inverse of encodeAttrValue — decodes the handful of entities TipTap/the DOM produce when
 *  serializing an attribute value, so the token emitted from a chip matches the original name. */
function decodeAttrValue(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Entity-encode a param name for use as the chip's visible TEXT run (`{{name}}`), as opposed
 *  to its attribute value. A name containing `<` (e.g. `A<B`) would otherwise open a bogus tag
 *  when the surrounding HTML string is parsed, silently swallowing subsequent content — so `&`,
 *  `<`, and `>` must be escaped here too. spansToTokens never reads this text run (it rebuilds
 *  `{{name}}` from the decoded attribute), so escaping it is pure display/parse safety. */
function escapeTextRun(name: string): string {
  return name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function tokensToSpans(html: string): string {
  return html.replace(
    TOKEN_RE,
    (_m, name: string) => `<span data-param-token="${encodeAttrValue(name)}">{{${escapeTextRun(name)}}}</span>`,
  )
}

export function spansToTokens(html: string): string {
  return html.replace(CHIP_SPAN_RE, (_m, name: string) => `{{${decodeAttrValue(name)}}}`)
}

/** Inspector preview: tags stripped, basic entities decoded (an authored `Tom &amp; Jerry`
 *  must preview as `Tom & Jerry`, not raw markup source — deferred final-review finding M5),
 *  tokens verbatim, whitespace collapsed, 120-char cap. `&amp;` decodes LAST so an authored
 *  literal `&amp;lt;` cannot double-decode into `<`. */
export function contentPreviewText(html: string): string {
  const text = html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 120 ? `${text.slice(0, 120)}…` : text
}
