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
import { FormPalette, PALETTE_ITEMS } from '../FormPalette'
import { useFormDocumentStore } from '@/stores/formDocumentStore'

beforeEach(() => {
  useFormDocumentStore.getState().openForNode('n', { version: 2, sections: [{ id: 's', role: 'content', rows: [] }] })
})

describe('FormPalette', () => {
  it('offers 11 types including header and esignature', () => {
    expect(PALETTE_ITEMS).toHaveLength(11)
    const types = PALETTE_ITEMS.map((i) => i.type)
    expect(types).toContain('header')
    expect(types).toContain('esignature')
  })

  it('palette has no Button element', () => {
    expect(PALETTE_ITEMS.map((i) => i.type as string)).not.toContain('button')
    render(<FormPalette />)
    expect(screen.queryByText('Button')).toBeNull()
  })

  it('clicking a palette item inserts that block type', () => {
    render(<FormPalette />)
    fireEvent.click(screen.getByText('Timer'))
    const all = useFormDocumentStore.getState().document.sections.flatMap((s) => s.rows.flatMap((r) => r.blocks))
    expect(all).toHaveLength(1)
    expect(all[0].type).toBe('timer')
  })

  it('exposes an accessible name on the collapse toggle', () => {
    render(<FormPalette />)
    expect(screen.getByRole('button', { name: 'Collapse palette' })).toBeTruthy()
  })

  it('disables E-signature once the document holds one (D9)', () => {
    useFormDocumentStore.getState().openForNode('n', {
      version: 2,
      sections: [
        {
          id: 's',
          role: 'content',
          rows: [{ id: 'r', blocks: [{ id: 'e', type: 'esignature', fieldName: 'approval' }] }],
        },
      ],
    })
    render(<FormPalette />)
    const btn = screen.getByText('E-signature').closest('button') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.title).toBe('A form can hold one e-signature')
    fireEvent.click(btn)
    const all = useFormDocumentStore.getState().document.sections.flatMap((s) => s.rows.flatMap((r) => r.blocks))
    expect(all).toHaveLength(1)
  })
})
