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
import { validateFormDocument } from '@mission/form-schema'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import type { PaletteBlockType } from '@/lib/form-document/create-block'

const TYPES: PaletteBlockType[] = [
  'text',
  'header',
  'textInput',
  'textarea',
  'checkbox',
  'radio',
  'image',
  'video',
  'divider',
  'timer',
]

describe('P3.2 insert -> save gate', () => {
  it('inserting every palette type yields a document that passes validateFormDocument', () => {
    useFormDocumentStore.getState().openForNode('n', { version: 2, sections: [{ id: 's', role: 'content', rows: [] }] })
    TYPES.forEach((t) => useFormDocumentStore.getState().insertBlock(t))
    const result = validateFormDocument(useFormDocumentStore.getState().document)
    expect(result.ok).toBe(true)
  })
})
