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

import { render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { describe, it, expect, beforeEach } from 'vitest'
import CatchNode from '../CatchNode'
import { useNotationStore } from '@/stores/notationStore'

function renderNode() {
  return render(
    <ReactFlowProvider>
      <CatchNode
        id="c1"
        type="catch"
        selected={false}
        dragging={false}
        draggable={true}
        selectable={true}
        deletable={true}
        zIndex={0}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        data={{ label: 'Recover', stepType: 'catch', catchId: 'C1' }}
      />
    </ReactFlowProvider>,
  )
}

describe('CatchNode', () => {
  beforeEach(() => useNotationStore.setState({ notation: 'flowchart' }))

  it('renders the label and the catch_id', () => {
    const { getByText } = renderNode()
    expect(getByText('Recover')).toBeTruthy()
    expect(getByText('C1')).toBeTruthy()
  })

  it('exposes exactly one source handle (CATCH has no incoming)', () => {
    const { container } = renderNode()
    const handles = container.querySelectorAll('.react-flow__handle')
    expect(handles.length).toBe(1)
    expect(handles[0].classList.contains('source')).toBe(true)
  })

  it('renders a 30x30 symbol (same as START/END)', () => {
    const { container } = renderNode()
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('30')
    expect(svg.getAttribute('height')).toBe('30')
  })

  it('does not rotate the polygon in flowchart', () => {
    const { container } = renderNode()
    expect(container.querySelector('polygon')!.getAttribute('transform')).toBeNull()
  })

  it('rotates the polygon 90 deg CCW in BPMN', () => {
    useNotationStore.setState({ notation: 'bpmn' })
    const { container } = renderNode()
    expect(container.querySelector('polygon')!.getAttribute('transform')).toBe('rotate(-90 15 15)')
  })
})
