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
import { render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'

// jsdom doesn't implement ResizeObserver — required by @xyflow/react internals.
global.ResizeObserver ??= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
import { FlowCanvas } from '@/components/canvas/FlowCanvas'
import { useCanEditActiveSpec } from '@/hooks/useCanEditActiveSpec'

vi.mock('@/hooks/useCanEditActiveSpec', () => ({ useCanEditActiveSpec: vi.fn() }))
// Keep the heavy canvas children inert.
vi.mock('@/components/canvas/CanvasToolbar', () => ({ CanvasToolbar: () => <div /> }))
vi.mock('@/components/canvas/CanvasContextMenu', () => ({ CanvasContextMenu: () => <div /> }))
vi.mock('@/components/canvas/AlignDropdown', () => ({ AlignDropdown: () => <div /> }))
vi.mock('@/components/canvas/DistributeDropdown', () => ({ DistributeDropdown: () => <div /> }))
vi.mock('@/components/nodes', () => ({ useNodeTypes: () => ({}) }))
vi.mock('@/components/edges', () => ({ edgeTypes: {} }))

function renderCanvas() {
  return render(
    <ReactFlowProvider>
      <FlowCanvas />
    </ReactFlowProvider>,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('FlowCanvas read-only', () => {
  it('shows a read-only badge when editing is not allowed', () => {
    vi.mocked(useCanEditActiveSpec).mockReturnValue(false)
    renderCanvas()
    expect(screen.getByText(/read-only/i)).not.toBeNull()
  })

  it('shows no read-only badge when editing is allowed', () => {
    vi.mocked(useCanEditActiveSpec).mockReturnValue(true)
    renderCanvas()
    expect(screen.queryByText(/read-only/i)).toBeNull()
  })
})
