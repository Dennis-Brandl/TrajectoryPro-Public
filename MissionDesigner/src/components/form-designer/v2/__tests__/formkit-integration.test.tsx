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
import { render } from '@testing-library/react'
import { FormDocumentView } from '@mission/form-renderer'
import { kitchenSinkDocument, validateFormDocument } from '@mission/form-schema'
import type { FormDocument } from '@mission/form-schema'

/**
 * P3.0 integration proof: Designer can consume the sibling MissionFormKit checkout.
 *
 * This is deliberately a rendering test rather than an import assertion, because rendering
 * is what actually proves the three things that can break across a `file:` dep on another
 * repo:
 *
 *  1. Module resolution — the symlinked packages resolve, and their TypeScript source is
 *     compiled by this app's pipeline (they ship `exports → ./src/*.ts`, no dist).
 *  2. React identity — FormKit carries its own React (19.2.7 vs ours), and vite resolves
 *     through the symlink into ITS node_modules. Without `resolve.dedupe`, two Reacts load
 *     and the first hook inside FormDocumentView throws "Invalid hook call". A rendered tree
 *     is proof there is exactly one React.
 *  3. Types — FormDocument/FormEvent typecheck across the repo boundary.
 *
 * It does NOT cover the tokens CSS pipeline (a build output, wired into `npm run build`).
 */
describe('FormKit integration', () => {
  it('renders a v2 form document through the shared renderer', () => {
    const { container } = render(<FormDocumentView document={kitchenSinkDocument} mode="edit" />)
    // Structure the renderer owns — proves its component tree ran, not just that it imported.
    expect(container.querySelector('.tfk-viewport')).not.toBeNull()
    expect(container.querySelectorAll('[data-block-id]').length).toBeGreaterThan(0)
  })

  it('exposes the schema validator, so Designer can reject malformed documents', () => {
    expect(validateFormDocument(kitchenSinkDocument).ok).toBe(true)
    const malformed = { version: 2, sections: [{ id: 's', role: 'nonsense', rows: [] }] }
    expect(validateFormDocument(malformed).ok).toBe(false)
  })

  it('renders both modes, which is the guarantee the editor will lean on', () => {
    // "One renderer, two modes": the editor gets the same tree the operator sees, with edit
    // mode adding inert. P3.1 has landed the real canvas (FormDocumentCanvas) on exactly this.
    const doc: FormDocument = kitchenSinkDocument
    const run = render(<FormDocumentView document={doc} mode="run" />).container.innerHTML
    const edit = render(<FormDocumentView document={doc} mode="edit" />).container.innerHTML
    expect(run).toContain('data-mode="run"')
    expect(edit).toContain('data-mode="edit"')
    expect(edit).toContain('inert')
  })
})
