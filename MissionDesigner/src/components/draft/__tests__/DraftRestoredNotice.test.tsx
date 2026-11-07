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

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { toast } from 'sonner'
import { DraftRestoredNotice } from '@/components/draft'
import { useFlowStore } from '@/stores/flowStore'
import type { WorkflowNode } from '@/types/nodes'

vi.mock('sonner', () => ({ toast: { info: vi.fn() } }))

const node: WorkflowNode = {
  id: 'n1',
  type: 'start',
  position: { x: 0, y: 0 },
  data: { label: 'Start', stepType: 'start' },
} as WorkflowNode

beforeEach(() => {
  vi.mocked(toast.info).mockClear()
  useFlowStore.setState({
    nodes: [node],
    edges: [],
    workflowValues: [],
    hasDraft: true,
    draftAt: '2026-11-06T10:00:00.000Z',
  })
})

describe('DraftRestoredNotice', () => {
  it('keeps the restored work, clears the flag, and announces it once', () => {
    render(<DraftRestoredNotice />)
    const s = useFlowStore.getState()
    expect(s.hasDraft).toBe(false)
    expect(s.nodes).toEqual([node])
    expect(toast.info).toHaveBeenCalledTimes(1)
    expect(vi.mocked(toast.info).mock.calls[0][0]).toMatch(/^Restored your unsaved work from /)
  })

  it('offers no way to discard the work (no "Start Fresh")', () => {
    render(<DraftRestoredNotice />)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.queryByText(/Start Fresh/i)).toBeNull()
  })

  it('does nothing when there is no draft', () => {
    useFlowStore.setState({ hasDraft: false })
    render(<DraftRestoredNotice />)
    expect(toast.info).not.toHaveBeenCalled()
    expect(useFlowStore.getState().nodes).toEqual([node])
  })
})
