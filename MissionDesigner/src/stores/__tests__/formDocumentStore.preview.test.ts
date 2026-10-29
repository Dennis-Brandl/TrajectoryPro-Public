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
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import { emptyDocument } from '@/lib/form-document/document-ops'

describe('formDocumentStore previewMode', () => {
  beforeEach(() => {
    useFormDocumentStore.getState().close()
    useFormDocumentStore.temporal.getState().clear()
  })

  it('defaults previewMode to edit', () => {
    expect(useFormDocumentStore.getState().previewMode).toBe('edit')
  })

  it('setPreviewMode switches the mode', () => {
    useFormDocumentStore.getState().setPreviewMode('preview')
    expect(useFormDocumentStore.getState().previewMode).toBe('preview')
  })

  it('openForNode resets previewMode to edit', () => {
    useFormDocumentStore.getState().setPreviewMode('preview')
    useFormDocumentStore.getState().openForNode('n1', emptyDocument())
    expect(useFormDocumentStore.getState().previewMode).toBe('edit')
  })

  it('close resets previewMode to edit', () => {
    useFormDocumentStore.getState().setPreviewMode('preview')
    useFormDocumentStore.getState().close()
    expect(useFormDocumentStore.getState().previewMode).toBe('edit')
  })

  it('setPreviewMode does not push an undo entry', () => {
    useFormDocumentStore.getState().openForNode('n1', emptyDocument()) // clears history
    const before = useFormDocumentStore.temporal.getState().pastStates.length
    useFormDocumentStore.getState().setPreviewMode('preview')
    expect(useFormDocumentStore.temporal.getState().pastStates.length).toBe(before)
  })
})
