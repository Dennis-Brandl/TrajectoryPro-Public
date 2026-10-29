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

import { describe, it, expect, beforeEach } from 'vitest'
import { useFormDocumentStore } from '../formDocumentStore'
import { emptyDocument } from '@/lib/form-document/document-ops'

describe('content editor open/close state', () => {
  beforeEach(() => useFormDocumentStore.getState().close())

  it('opens and closes for a block id', () => {
    useFormDocumentStore.getState().openContentEditor('b1')
    expect(useFormDocumentStore.getState().contentEditorBlockId).toBe('b1')
    useFormDocumentStore.getState().closeContentEditor()
    expect(useFormDocumentStore.getState().contentEditorBlockId).toBeNull()
  })

  it('openForNode and close both reset it', () => {
    useFormDocumentStore.getState().openContentEditor('b1')
    useFormDocumentStore.getState().openForNode('n1', emptyDocument())
    expect(useFormDocumentStore.getState().contentEditorBlockId).toBeNull()
    useFormDocumentStore.getState().openContentEditor('b2')
    useFormDocumentStore.getState().close()
    expect(useFormDocumentStore.getState().contentEditorBlockId).toBeNull()
  })
})
