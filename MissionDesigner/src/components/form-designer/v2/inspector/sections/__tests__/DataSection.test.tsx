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
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DataSection } from '../DataSection'
import { useFlowStore } from '@/stores/flowStore'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import type { TextInputBlock } from '@mission/form-schema'
import { createDefaultBlock } from '@/lib/form-document/create-block'

const block: TextInputBlock = { id: 'b', type: 'textInput', fieldName: 'name', required: false }

beforeEach(() => {
  useFlowStore.setState({
    nodes: [{ id: 'n', type: 'userInteractionStep', position: { x: 0, y: 0 }, data: { inputs: [] } }] as never,
  })
  useFormDocumentStore.getState().close()
  useFormDocumentStore
    .getState()
    .openForNode('n', { version: 2, sections: [{ id: 's', role: 'content', rows: [{ id: 'r', blocks: [block] }] }] })
})

describe('DataSection', () => {
  it('toggles required', () => {
    const onUpdate = vi.fn()
    render(<DataSection block={block} onUpdate={onUpdate} allBlocks={[block]} />)
    fireEvent.click(screen.getByLabelText(/required/i))
    expect(onUpdate).toHaveBeenCalledWith({ required: true })
  })

  it('adds a list item whose value starts out as its label, unchanged', () => {
    const listBlock: TextInputBlock = { ...block, inputMode: 'combobox', listItems: [] }
    const onUpdate = vi.fn()
    render(<DataSection block={listBlock} onUpdate={onUpdate} allBlocks={[listBlock]} />)
    const input = screen.getByPlaceholderText('Type and press Enter')
    fireEvent.change(input, { target: { value: 'New Workcenter' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onUpdate).toHaveBeenCalledWith({ listItems: [{ label: 'New Workcenter', value: 'New Workcenter' }] })
  })

  it('sets a static default value on a textInput', () => {
    const block = createDefaultBlock('textInput')
    const onUpdate = vi.fn()
    render(<DataSection block={block} onUpdate={onUpdate} allBlocks={[block]} />)
    fireEvent.change(screen.getByLabelText('Default Value'), { target: { value: 'hello' } })
    expect(onUpdate).toHaveBeenCalledWith({ defaultSource: { mode: 'static', value: 'hello' } })
  })

  it('resets the debounced Label draft when a different block is selected', () => {
    // Regression guard for the render-time draft sync (formerly a set-state-in-effect): the
    // Label input must track the selected block, not keep showing the previous block's text.
    const a: TextInputBlock = { id: 'a', type: 'textInput', fieldName: 'fa', required: false, label: 'Alpha' }
    const b: TextInputBlock = { id: 'b2', type: 'textInput', fieldName: 'fb', required: false, label: 'Beta' }
    const { rerender } = render(<DataSection block={a} onUpdate={vi.fn()} allBlocks={[a]} />)
    const labelInput = () => screen.getByPlaceholderText('Label text...') as HTMLInputElement
    expect(labelInput().value).toBe('Alpha')
    rerender(<DataSection block={b} onUpdate={vi.fn()} allBlocks={[b]} />)
    expect(labelInput().value).toBe('Beta')
  })

  it('gives the textInput/textarea fields the same side padding as every other section', () => {
    // Regression: this branch (distinct from the checkbox/radio return) kept a bare wrapper,
    // so its fields sat flush-left while the other sections were inset 12px.
    const { container } = render(<DataSection block={block} onUpdate={vi.fn()} allBlocks={[block]} />)
    expect((container.firstChild as HTMLElement).style.padding).toBe('4px 12px 12px')
  })
})
