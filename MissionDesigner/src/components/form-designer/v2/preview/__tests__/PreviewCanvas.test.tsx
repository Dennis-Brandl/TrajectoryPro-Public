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

  it('renders the document in run mode with a decision bar', () => {
    useFormDocumentStore.getState().openForNode('n1', textDoc())
    render(<PreviewCanvas />)
    expect(screen.getByText('Hello preview')).toBeTruthy()
    expect(screen.getByTestId('preview-decision-bar')).toBeTruthy()
    // No flowStore node → default userInteraction Continue.
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()
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

    it('keeps the bar when the form would leave the author stuck', () => {
      asYesNo()
      useFormDocumentStore.getState().openForNode('n1', jobDoc([btn('y', 'yes')])) // no "No"
      render(<PreviewCanvas />)
      expect(screen.getByTestId('preview-decision-bar')).toBeTruthy()
    })
  })
})
