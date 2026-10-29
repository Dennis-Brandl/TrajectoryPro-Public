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
import { render, screen, fireEvent } from '@testing-library/react'
import { ContentSection } from '../ContentSection'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import type { TextBlock } from '@mission/form-schema'

describe('ContentSection', () => {
  it('shows a stripped-text preview and opens the content editor from the Edit button', () => {
    useFormDocumentStore.getState().close()
    render(<ContentSection block={{ id: 'b', type: 'text', content: 'Lot <strong>{{Lot}}</strong>' } as TextBlock} />)
    expect(screen.getByTestId('content-preview').textContent).toBe('Lot {{Lot}}')
    fireEvent.click(screen.getByRole('button', { name: /edit content/i }))
    expect(useFormDocumentStore.getState().contentEditorBlockId).toBe('b')
  })
})
