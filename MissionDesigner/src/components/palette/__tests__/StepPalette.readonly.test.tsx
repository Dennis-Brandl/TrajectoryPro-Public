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
import { ReactFlowProvider } from '@xyflow/react'
import { StepPalette } from '@/components/palette/StepPalette'
import { useCanEditActiveSpec } from '@/hooks/useCanEditActiveSpec'
import { useFlowStore } from '@/stores/flowStore'

vi.mock('@/hooks/useCanEditActiveSpec', () => ({ useCanEditActiveSpec: vi.fn() }))

function renderPalette() {
  return render(
    <ReactFlowProvider>
      <StepPalette />
    </ReactFlowProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  useFlowStore.setState({ nodes: [] })
})

describe('StepPalette read-only', () => {
  it('items are not draggable and click-add is a no-op when read-only', () => {
    vi.mocked(useCanEditActiveSpec).mockReturnValue(false)
    const addNode = vi.spyOn(useFlowStore.getState(), 'addNode')
    renderPalette()
    const item = screen.getByRole('button', { name: /Add Start step/i })
    expect(item.getAttribute('draggable')).toBe('false')
    fireEvent.click(item)
    expect(addNode).not.toHaveBeenCalled()
  })

  it('items are draggable when editable', () => {
    vi.mocked(useCanEditActiveSpec).mockReturnValue(true)
    renderPalette()
    expect(screen.getByRole('button', { name: /Add Start step/i }).getAttribute('draggable')).toBe('true')
  })
})
