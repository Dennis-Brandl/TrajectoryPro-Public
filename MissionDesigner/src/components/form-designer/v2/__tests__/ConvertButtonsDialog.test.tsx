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

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ConvertButtonsDialog } from '../ConvertButtonsDialog'
import { useFlowStore } from '@/stores/flowStore'
import type { WorkflowNode } from '@/types/nodes'

const canEditMock = vi.hoisted(() => ({ value: true }))
vi.mock('@/hooks/useCanEditActiveSpec', () => ({ useCanEditActiveSpec: () => canEditMock.value }))
const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: vi.fn() } }))

const emptyForm = { version: 2, sections: [{ id: 's', role: 'content', rows: [] }] }
const nodeOf = (id: string, type: string, data: Record<string, unknown>) =>
  ({ id, type, position: { x: 0, y: 0 }, data }) as unknown as WorkflowNode

let updateNodesData: ReturnType<typeof vi.fn>

beforeEach(() => {
  canEditMock.value = true
  toastSuccess.mockClear()
  updateNodesData = vi.fn()
  useFlowStore.setState({ nodes: [], updateNodesData } as never)
})

describe('ConvertButtonsDialog', () => {
  it('lists each step name with its change sentences; Cancel does nothing', () => {
    useFlowStore.setState({
      nodes: [
        nodeOf('a', 'userInteractionStep', { label: 'Check pump', formDocument: emptyForm }),
        nodeOf('b', 'yesNoStep', { label: 'Ready?', formDocument: emptyForm }),
      ],
    })
    const onClose = vi.fn()
    render(<ConvertButtonsDialog open onClose={onClose} />)
    expect(screen.getByText('Check pump')).not.toBeNull()
    expect(screen.getByText('Ready?')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(updateNodesData).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('Apply calls updateNodesData once with every changed node, then toasts', () => {
    useFlowStore.setState({
      nodes: [
        nodeOf('a', 'userInteractionStep', { label: 'A', formDocument: emptyForm }),
        nodeOf('b', 'yesNoStep', { label: 'B', formDocument: emptyForm }),
        nodeOf('c', 'scriptStep', { label: 'C', formDocument: emptyForm }),
      ],
    })
    const onClose = vi.fn()
    render(<ConvertButtonsDialog open onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(updateNodesData).toHaveBeenCalledTimes(1)
    const arg = updateNodesData.mock.calls[0][0] as Array<{ id: string; data: { formDocument: unknown } }>
    expect(arg.map((u) => u.id)).toEqual(['a', 'b'])
    expect(arg[0].data.formDocument).not.toBe(emptyForm)
    expect(toastSuccess).toHaveBeenCalledWith('Converted buttons in 2 form(s).')
    expect(onClose).toHaveBeenCalled()
  })

  it('with nothing to convert shows a message and only a Close button', () => {
    useFlowStore.setState({ nodes: [nodeOf('c', 'scriptStep', { formDocument: emptyForm })] })
    render(<ConvertButtonsDialog open onClose={() => {}} />)
    expect(screen.getByText('All forms already use their own buttons.')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    const closes = screen.getAllByRole('button', { name: 'Close' })
    expect(closes.some((b) => b.textContent === 'Close')).toBe(true)
  })

  it('lists the never-stuck problems that remain after conversion', () => {
    const stuck = {
      version: 2,
      sections: [
        {
          id: 's',
          role: 'content',
          rows: [
            { id: 'r', blocks: [{ id: 'b', type: 'button', label: '', outputValue: 'continue', job: 'continue' }] },
          ],
        },
      ],
    }
    useFlowStore.setState({ nodes: [nodeOf('a', 'yesNoStep', { label: 'Stuck', formDocument: stuck })] })
    render(<ConvertButtonsDialog open onClose={() => {}} />)
    expect(screen.getByRole('alert').textContent?.length).toBeGreaterThan(0)
  })

  it('Apply does nothing on a read-only spec', () => {
    canEditMock.value = false
    useFlowStore.setState({ nodes: [nodeOf('a', 'userInteractionStep', { label: 'A', formDocument: emptyForm })] })
    render(<ConvertButtonsDialog open onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(updateNodesData).not.toHaveBeenCalled()
  })
})
