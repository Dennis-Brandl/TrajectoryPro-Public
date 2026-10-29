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
import { render, screen, fireEvent } from '@testing-library/react'
import { FormDocumentCanvas } from '../FormDocumentCanvas'
import { useFormDocumentStore } from '@/stores/formDocumentStore'

const withBlock = {
  version: 2 as const,
  sections: [
    {
      id: 's',
      role: 'content' as const,
      rows: [{ id: 'r', blocks: [{ id: 'b', type: 'text' as const, content: 'hi' }] }],
    },
  ],
}
const empty = { version: 2 as const, sections: [{ id: 's', role: 'content' as const, rows: [] }] }

beforeEach(() => {
  try {
    localStorage.clear()
  } catch {
    /* storage unavailable */
  }
  useFormDocumentStore.getState().close()
})

describe('FormDocumentCanvas hints', () => {
  it('shows how to arrange elements and make columns, with a link to the help guide', () => {
    useFormDocumentStore.getState().openForNode('n', withBlock)
    render(<FormDocumentCanvas />)
    const tips = screen.getByRole('note', { name: 'Arranging tips' })
    expect(tips.textContent).toMatch(/columns/i)
    const link = screen.getByRole('link', { name: /help/i }) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/help.html#adding-and-arranging-elements')
  })

  it('the tips can be dismissed and stay dismissed', () => {
    useFormDocumentStore.getState().openForNode('n', withBlock)
    const { unmount } = render(<FormDocumentCanvas />)
    fireEvent.click(screen.getByRole('button', { name: 'Hide tips' }))
    expect(screen.queryByRole('note', { name: 'Arranging tips' })).toBeNull()
    unmount()
    render(<FormDocumentCanvas />)
    expect(screen.queryByRole('note', { name: 'Arranging tips' })).toBeNull()
  })

  it('an empty form says how to add the first element', () => {
    useFormDocumentStore.getState().openForNode('n', empty)
    render(<FormDocumentCanvas />)
    expect(screen.getByText(/click an element in the palette/i)).not.toBeNull()
  })
})
