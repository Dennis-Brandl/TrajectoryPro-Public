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
import type { FormDocument } from '@mission/form-schema'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import { useFlowStore } from '@/stores/flowStore'
import { PreviewCanvas } from '../PreviewCanvas'

// Deterministic image resolver so an oid-backed image renders in run mode.
vi.mock('../../useImageResolver', () => ({
  useImageResolver: () => (key: string) => (key === 'oid1' ? 'data:image/png;base64,AAAA' : undefined),
}))

function textDoc(): FormDocument {
  return {
    version: 2,
    sections: [
      {
        id: 's1',
        role: 'content',
        rows: [{ id: 'r1', blocks: [{ id: 'b1', type: 'text', content: 'Hello preview' }] as never }],
      },
    ],
  } as FormDocument
}
function inputDoc(): FormDocument {
  return {
    version: 2,
    sections: [
      {
        id: 's1',
        role: 'content',
        rows: [{ id: 'r1', blocks: [{ id: 'b1', type: 'textInput', fieldName: 'serial', label: 'Serial' }] as never }],
      },
    ],
  } as FormDocument
}
function imageDoc(): FormDocument {
  return {
    version: 2,
    sections: [
      {
        id: 's1',
        role: 'content',
        rows: [
          {
            id: 'r1',
            blocks: [
              { id: 'b1', type: 'image', src: 'oid1', imageOid: 'oid1', layout: { aspectRatio: '16/9' } },
            ] as never,
          },
        ],
      },
    ],
  } as FormDocument
}

describe('PreviewCanvas', () => {
  beforeEach(() => {
    useFormDocumentStore.getState().close()
  })

  it('renders the document in run mode with the one Continue Pilot will show, and no bar of its own', () => {
    useFormDocumentStore.getState().openForNode('n1', textDoc())
    render(<PreviewCanvas />)
    expect(screen.getByText('Hello preview')).toBeTruthy()
    expect(screen.queryByTestId('preview-decision-bar')).toBeNull()
    // No flowStore node → default userInteraction: the form has no button, so a centered Continue is added.
    expect(screen.getAllByRole('button', { name: 'Continue' })).toHaveLength(1)
  })

  it("shows the active tab's rows (Tablet/Phone can have their own)", () => {
    const doc = textDoc()
    doc.sections[0].rows.push({ id: 'r2', blocks: [{ id: 'b2', type: 'text', content: 'Second' }] })
    doc.sections[0].rowsAt = { tablet: [{ id: 't', blockIds: ['b2', 'b1'] }] }
    useFormDocumentStore.getState().openForNode('n1', doc)
    useFormDocumentStore.getState().setActiveBreakpoint('tablet')
    const { container } = render(<PreviewCanvas />)
    expect(container.querySelector('[data-rows-breakpoint]')?.getAttribute('data-rows-breakpoint')).toBe('tablet')
    const text = container.textContent ?? ''
    expect(text.indexOf('Second')).toBeLessThan(text.indexOf('Hello preview'))
  })

  it('renders an oid-backed image via the resolver', () => {
    useFormDocumentStore.getState().openForNode('n1', imageDoc())
    const { container } = render(<PreviewCanvas />)
    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toBe('data:image/png;base64,AAAA')
  })

  it('typing persists (controlled by the host) and Restart clears it', () => {
    useFormDocumentStore.getState().openForNode('n1', inputDoc())
    const { container } = render(<PreviewCanvas />)
    const input = container.querySelector('input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'SN-1' } })
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('SN-1')
    fireEvent.click(screen.getByRole('button', { name: 'Restart preview' }))
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('')
  })

  describe('form-owned job buttons', () => {
    const btn = (id: string, job: 'continue' | 'yes' | 'no', label = '') => ({
      id,
      type: 'button',
      label,
      outputValue: job,
      job,
    })
    const jobDoc = (blocks: unknown[]): FormDocument =>
      ({
        version: 2,
        sections: [{ id: 's1', role: 'content', rows: [{ id: 'r1', blocks }] }],
      }) as unknown as FormDocument
    const asYesNo = () =>
      useFlowStore.setState({ nodes: [{ id: 'n1', type: 'yesNoStep', position: { x: 0, y: 0 }, data: {} }] as never })

    it('hides the decision bar and runs the form Yes with the yes routing value', () => {
      asYesNo()
      useFormDocumentStore.getState().openForNode('n1', jobDoc([btn('y', 'yes'), btn('n', 'no')]))
      render(<PreviewCanvas />)
      expect(screen.queryByTestId('preview-decision-bar')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Yes' }))
      expect(screen.getByTestId('preview-last-decision').textContent).toContain('true')
    })

    it('adds the button the form lacks, as Pilot does, instead of a bar', () => {
      asYesNo()
      useFormDocumentStore.getState().openForNode('n1', jobDoc([btn('y', 'yes')])) // no "No"
      render(<PreviewCanvas />)
      expect(screen.queryByTestId('preview-decision-bar')).toBeNull()
      expect(screen.getAllByRole('button', { name: 'Yes' })).toHaveLength(1)
      expect(screen.getAllByRole('button', { name: 'No' })).toHaveLength(1)
    })
  })

  describe('fixed button row', () => {
    const fixedDoc = (): FormDocument =>
      ({
        version: 2,
        sections: [
          {
            id: 's1',
            role: 'content',
            rows: [
              { id: 'r1', blocks: [{ id: 't', type: 'text', content: 'Body' }] },
              {
                id: 'r2',
                blocks: [{ id: 'old', type: 'button', label: 'Old go', outputValue: 'continue', job: 'continue' }],
              },
            ],
          },
        ],
      }) as unknown as FormDocument
    const asFixed = (type: string, extra: Record<string, unknown> = {}) =>
      useFlowStore.setState({
        nodes: [{ id: 'n1', type, position: { x: 0, y: 0 }, data: { buttonBar: {}, ...extra } }] as never,
      })

    it('preview of a fixed step shows the step bar, not form buttons', () => {
      asFixed('userInteractionStep')
      useFormDocumentStore.getState().openForNode('n1', fixedDoc())
      const { container } = render(<PreviewCanvas />)
      expect(screen.queryByText('Old go')).toBeNull()
      expect(screen.getAllByRole('button', { name: 'Continue' })).toHaveLength(1)
      expect(container.querySelector('.tfk-step-bar')).not.toBeNull()
      expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
      expect(screen.getByTestId('preview-last-decision').textContent).toContain('complete')
    })

    it('shows Back and Stop (inert) when the step allows them', () => {
      asFixed('userInteractionStep', { allowBack: true, allowStop: true })
      useFormDocumentStore.getState().openForNode('n1', fixedDoc())
      render(<PreviewCanvas />)
      fireEvent.click(screen.getByRole('button', { name: 'Back' }))
      fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
      expect(screen.getByTestId('preview-last-decision').textContent).not.toContain('complete')
    })

    it('a fixed Yes/No step shows Yes and No from the bar and routes Yes', () => {
      asFixed('yesNoStep')
      useFormDocumentStore.getState().openForNode('n1', fixedDoc())
      render(<PreviewCanvas />)
      expect(screen.getAllByRole('button', { name: 'Yes' })).toHaveLength(1)
      expect(screen.getAllByRole('button', { name: 'No' })).toHaveLength(1)
      fireEvent.click(screen.getByRole('button', { name: 'Yes' }))
      expect(screen.getByTestId('preview-last-decision').textContent).toContain('true')
    })
  })
})
