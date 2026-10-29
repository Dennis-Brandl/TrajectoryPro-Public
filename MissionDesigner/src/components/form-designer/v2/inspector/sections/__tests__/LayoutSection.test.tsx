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
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LayoutSection } from '../LayoutSection'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import { createDefaultBlock } from '@/lib/form-document/create-block'

beforeEach(() => useFormDocumentStore.getState().setActiveBreakpoint('base'))

describe('LayoutSection', () => {
  it('writes a COMPLETE layout (read-modify-write preserves siblings)', () => {
    const block = { ...createDefaultBlock('text'), layout: { align: 'center' as const } }
    const onUpdate = vi.fn()
    render(<LayoutSection block={block} onUpdate={onUpdate} />)
    fireEvent.change(screen.getByLabelText('Span'), { target: { value: '6' } })
    // patch must include BOTH the new span and the pre-existing align
    expect(onUpdate).toHaveBeenCalledWith({ layout: { align: 'center', span: { base: 6 } } })
  })

  it('editing at the phone tab sets a phone override, not base', () => {
    useFormDocumentStore.getState().setActiveBreakpoint('phone')
    const block = { ...createDefaultBlock('text'), layout: { span: { base: 12 as const } } }
    const onUpdate = vi.fn()
    render(<LayoutSection block={block} onUpdate={onUpdate} />)
    fireEvent.change(screen.getByLabelText('Span'), { target: { value: '4' } })
    expect(onUpdate).toHaveBeenCalledWith({ layout: { span: { base: 12, phone: 4 } } })
  })

  it('image keeps a non-empty aspectRatio field', () => {
    const block = createDefaultBlock('image')
    render(<LayoutSection block={block} onUpdate={vi.fn()} />)
    expect((screen.getByLabelText('Aspect Ratio') as HTMLInputElement).value).toBe('16/9')
  })

  describe('order', () => {
    it('order at base writes order:{base:N}, preserving siblings', () => {
      const block = { ...createDefaultBlock('text'), layout: { align: 'center' as const } }
      const onUpdate = vi.fn()
      render(<LayoutSection block={block} onUpdate={onUpdate} />)
      fireEvent.change(screen.getByLabelText('Order (base)'), { target: { value: '3' } })
      expect(onUpdate).toHaveBeenCalledWith({ layout: { align: 'center', order: { base: 3 } } })
    })

    it('editing order at the phone tab sets a phone override, not base', () => {
      useFormDocumentStore.getState().setActiveBreakpoint('phone')
      const block = { ...createDefaultBlock('text'), layout: { order: { base: 1 as const } } }
      const onUpdate = vi.fn()
      render(<LayoutSection block={block} onUpdate={onUpdate} />)
      fireEvent.change(screen.getByLabelText('Order (phone)'), { target: { value: '3' } })
      expect(onUpdate).toHaveBeenCalledWith({ layout: { order: { base: 1, phone: 3 } } })
    })

    it('clearing order at base removes the order key entirely, preserving siblings', () => {
      const block = {
        ...createDefaultBlock('text'),
        layout: { align: 'center' as const, order: { base: 2 as const } },
      }
      const onUpdate = vi.fn()
      render(<LayoutSection block={block} onUpdate={onUpdate} />)
      fireEvent.change(screen.getByLabelText('Order (base)'), { target: { value: '' } })
      expect(onUpdate).toHaveBeenCalledWith({ layout: { align: 'center' } })
    })

    it('first order edit at the phone tab does not set all breakpoints', () => {
      useFormDocumentStore.getState().setActiveBreakpoint('phone')
      const block = { ...createDefaultBlock('text'), layout: { align: 'center' as const } }
      const onUpdate = vi.fn()
      render(<LayoutSection block={block} onUpdate={onUpdate} />)
      fireEvent.change(screen.getByLabelText('Order (phone)'), { target: { value: '3' } })
      expect(onUpdate).toHaveBeenCalledWith({ layout: { align: 'center', order: { base: 0, phone: 3 } } })
    })

    it('the Auto button resets order to automatic at base, preserving siblings', () => {
      const block = {
        ...createDefaultBlock('text'),
        layout: { align: 'center' as const, order: { base: 2 as const } },
      }
      const onUpdate = vi.fn()
      render(<LayoutSection block={block} onUpdate={onUpdate} />)
      fireEvent.click(screen.getByRole('button', { name: /reset order to automatic/i }))
      expect(onUpdate).toHaveBeenCalledWith({ layout: { align: 'center' } })
    })

    it('the Auto button is disabled when order is already automatic', () => {
      const block = { ...createDefaultBlock('text'), layout: { align: 'center' as const } }
      render(<LayoutSection block={block} onUpdate={vi.fn()} />)
      expect((screen.getByRole('button', { name: /reset order to automatic/i }) as HTMLButtonElement).disabled).toBe(
        true,
      )
    })
  })

  describe('minHeight', () => {
    it('minHeight select writes the chosen SpaceToken, preserving siblings', () => {
      const block = { ...createDefaultBlock('text'), layout: { align: 'center' as const } }
      const onUpdate = vi.fn()
      render(<LayoutSection block={block} onUpdate={onUpdate} />)
      fireEvent.change(screen.getByLabelText('Min Height'), { target: { value: 'md' } })
      expect(onUpdate).toHaveBeenCalledWith({ layout: { align: 'center', minHeight: 'md' } })
    })

    it('minHeight "(unset)" removes an existing token minHeight, preserving siblings', () => {
      const block = { ...createDefaultBlock('text'), layout: { minHeight: 'lg' as const, align: 'center' as const } }
      const onUpdate = vi.fn()
      render(<LayoutSection block={block} onUpdate={onUpdate} />)
      fireEvent.change(screen.getByLabelText('Min Height'), { target: { value: '' } })
      expect(onUpdate).toHaveBeenCalledWith({ layout: { align: 'center' } })
    })

    it('a {rem} minHeight renders as "(unset)" and is never clobbered merely by rendering', () => {
      const block = { ...createDefaultBlock('text'), layout: { minHeight: { rem: 4 } } }
      const onUpdate = vi.fn()
      render(<LayoutSection block={block} onUpdate={onUpdate} />)
      expect((screen.getByLabelText('Min Height') as HTMLSelectElement).value).toBe('')
      expect(onUpdate).not.toHaveBeenCalled()
    })
  })

  describe('maxWidth', () => {
    it('maxWidth entry writes {ch:N} by default, preserving siblings', () => {
      const block = { ...createDefaultBlock('text'), layout: { align: 'center' as const } }
      const onUpdate = vi.fn()
      render(<LayoutSection block={block} onUpdate={onUpdate} />)
      fireEvent.change(screen.getByLabelText('Max Width'), { target: { value: '60' } })
      expect(onUpdate).toHaveBeenCalledWith({ layout: { align: 'center', maxWidth: { ch: 60 } } })
    })

    it('switching the maxWidth unit to rem preserves the numeric value', () => {
      const block = { ...createDefaultBlock('text'), layout: { maxWidth: { ch: 60 } } }
      const onUpdate = vi.fn()
      render(<LayoutSection block={block} onUpdate={onUpdate} />)
      fireEvent.change(screen.getByLabelText('Max width unit'), { target: { value: 'rem' } })
      expect(onUpdate).toHaveBeenCalledWith({ layout: { maxWidth: { rem: 60 } } })
    })

    it('clearing the maxWidth input removes the maxWidth key, preserving siblings', () => {
      const block = { ...createDefaultBlock('text'), layout: { maxWidth: { ch: 60 }, align: 'center' as const } }
      const onUpdate = vi.fn()
      render(<LayoutSection block={block} onUpdate={onUpdate} />)
      fireEvent.change(screen.getByLabelText('Max Width'), { target: { value: '' } })
      expect(onUpdate).toHaveBeenCalledWith({ layout: { align: 'center' } })
    })
  })

  describe('clear override button includes order', () => {
    it('clears a phone order override together with span/visible', () => {
      useFormDocumentStore.getState().setActiveBreakpoint('phone')
      const block = {
        ...createDefaultBlock('text'),
        layout: { order: { base: 1 as const, phone: 3 as const } },
      }
      const onUpdate = vi.fn()
      render(<LayoutSection block={block} onUpdate={onUpdate} />)
      fireEvent.click(screen.getByText('Clear phone override (inherit desktop)'))
      expect(onUpdate).toHaveBeenCalledWith({
        layout: { span: { base: 12 }, visible: { base: true }, order: { base: 1 } },
      })
    })

    it('does not materialize an order key when clearing span/visible if order was never set', () => {
      useFormDocumentStore.getState().setActiveBreakpoint('phone')
      const block = { ...createDefaultBlock('text'), layout: { span: { base: 12 as const, phone: 4 as const } } }
      const onUpdate = vi.fn()
      render(<LayoutSection block={block} onUpdate={onUpdate} />)
      fireEvent.click(screen.getByText('Clear phone override (inherit desktop)'))
      expect(onUpdate).toHaveBeenCalledWith({
        layout: { span: { base: 12 }, visible: { base: true } },
      })
    })
  })

  describe('columns', () => {
    const rowsDoc = (rows: string[]) => ({
      version: 2 as const,
      sections: [
        {
          id: 's',
          role: 'content' as const,
          rows: rows.map((r, i) => ({
            id: `r${i}`,
            blocks: [...r].map((id) => ({ id, type: 'text' as const, content: id })),
          })),
        },
      ],
    })
    const shape = () =>
      useFormDocumentStore.getState().document.sections[0].rows.map((r) => r.blocks.map((b) => b.id).join(''))
    const blockOf = (id: string) =>
      useFormDocumentStore
        .getState()
        .document.sections[0].rows.flatMap((r) => r.blocks)
        .find((b) => b.id === id)!

    it('arranges the row in N columns', () => {
      useFormDocumentStore.getState().openForNode('n', rowsDoc(['A', 'B', 'C']))
      render(<LayoutSection block={blockOf('A')} onUpdate={vi.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: 'Arrange in 2 columns' }))
      expect(shape()).toEqual(['AB', 'C'])
    })

    it('moves into the row above, and back to its own row', () => {
      useFormDocumentStore.getState().openForNode('n', rowsDoc(['A', 'B']))
      const { unmount } = render(<LayoutSection block={blockOf('B')} onUpdate={vi.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: /move into row above/i }))
      expect(shape()).toEqual(['AB'])
      unmount()
      render(<LayoutSection block={blockOf('B')} onUpdate={vi.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: /move to its own row/i }))
      expect(shape()).toEqual(['A', 'B'])
    })
  })
})
