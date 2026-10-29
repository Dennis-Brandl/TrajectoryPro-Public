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
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { kitchenSinkDocument, type FormDocument } from '@mission/form-schema'
import { FormDocumentView } from '@mission/form-renderer'
import '@mission/form-tokens/css/light'
import '@mission/form-renderer/layout.css'
import '@mission/form-renderer/controls.css'
import './golden.css'

const WIDTHS = [380, 768, 1440] as const
type Width = (typeof WIDTHS)[number]

// Deterministic inline-SVG data URI — stable, no network.
const IMG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120">' +
      '<rect width="100%" height="100%" fill="#93c5fd"/>' +
      '<rect x="8" y="8" width="144" height="104" fill="none" stroke="#1e3a8a" stroke-width="4"/>' +
      '</svg>',
  )

/** Give every video block a data-URI poster so preload="none" shows a stable image
 *  instead of an empty player. Media is the only override; block set tracks the fixture. */
function withDeterministicMedia(doc: FormDocument): FormDocument {
  return {
    ...doc,
    sections: doc.sections.map((s) => ({
      ...s,
      rows: s.rows.map((r) => ({
        ...r,
        blocks: r.blocks.map((b) => (b.type === 'video' ? { ...b, posterUrl: IMG } : b)),
      })),
    })),
  }
}

const KNOWN: Record<string, string> = { 'pump.jpg': IMG }
const goldenImages = (srcKey: string): string | undefined =>
  Object.hasOwn(KNOWN, srcKey) ? KNOWN[srcKey] : undefined

const goldenDocument = withDeterministicMedia(kitchenSinkDocument)

const params = new URLSearchParams(location.search)
const wParam = Number(params.get('w'))
const width: Width = (WIDTHS as readonly number[]).includes(wParam) ? (wParam as Width) : 1440
const mode = params.get('mode') === 'edit' ? 'edit' : 'run'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="golden-frame" style={{ width }}>
      <FormDocumentView document={goldenDocument} mode={mode} images={goldenImages} />
    </div>
  </StrictMode>,
)
