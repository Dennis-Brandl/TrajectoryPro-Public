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
import { useFlowStore } from '@/stores/flowStore'

beforeEach(() => {
  useFormDocumentStore.getState().openForNode('n', { version: 2, sections: [{ id: 's', role: 'content', rows: [] }] })
})

describe('FormPalette', () => {
  it('offers 12 types including header, esignature and button', () => {
    expect(PALETTE_ITEMS).toHaveLength(12)
    const types = PALETTE_ITEMS.map((i) => i.type)
    expect(types).toContain('header')
    expect(types).toContain('esignature')
    expect(types).toContain('button')
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

  function openAs(nodeType: string) {
    useFlowStore.setState({ nodes: [{ id: 'n', type: nodeType, position: { x: 0, y: 0 }, data: {} }] } as never)
  }
  function footerBlocks() {
    return useFormDocumentStore
      .getState()
      .document.sections.filter((s) => s.role === 'footer')
      .flatMap((s) => s.rows.flatMap((r) => r.blocks))
  }

  it('Button on a Yes/No step inserts a Yes button into a new bottom bar', () => {
    openAs('yesNoStep')
    render(<FormPalette />)
    fireEvent.click(screen.getByText('Button'))
    const f = footerBlocks()
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ type: 'button', job: 'yes', outputValue: 'true' })
  })

  it('Button on a normal step inserts a Continue button', () => {
    openAs('userInteractionStep')
    render(<FormPalette />)
    fireEvent.click(screen.getByText('Button'))
    expect(footerBlocks()[0]).toMatchObject({ type: 'button', job: 'continue', outputValue: 'continue' })
  })

  it('drag insert (insertBlockAt) places the button where dropped', () => {
    openAs('userInteractionStep')
    useFormDocumentStore.getState().openForNode('n', {
      version: 2,
      sections: [{ id: 's', role: 'content', rows: [{ id: 'r', blocks: [{ id: 'b', type: 'text', content: 'x' }] }] }],
    })
    useFormDocumentStore.getState().insertBlockAt('button', { kind: 'new-row', sectionId: 's', afterRowId: null })
    const rows = useFormDocumentStore.getState().document.sections[0].rows
    expect(rows[0].blocks[0].type).toBe('button')
  })
})
