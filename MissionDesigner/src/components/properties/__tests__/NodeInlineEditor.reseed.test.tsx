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
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { NodeInlineEditor } from '../NodeInlineEditor'
import { useFlowStore } from '@/stores/flowStore'
import type { StepNodeData } from '@/types/nodes'

vi.mock('../ScriptEditorModal', () => ({ ScriptEditorModal: () => null }))

function panel(data: StepNodeData) {
  return (
    <ReactFlowProvider>
      <NodeInlineEditor
        nodeType="scriptStep"
        nodeId="n1"
        initialData={data}
        initialChildData={null}
        isEmbeddedSubWorkflow={false}
        isReferencedSubWorkflow={false}
      />
    </ReactFlowProvider>
  )
}

describe('NodeInlineEditor re-seeds its draft when nodeDataRevision changes (spec 2026-09-04 §6.4.4)', () => {
  beforeEach(() => useFlowStore.setState({ nodes: [], edges: [], nodeDataRevision: 0 }))

  it('shows the new node data and does not autosave the re-seeded draft', async () => {
    const updateNodeData = vi.fn()
    useFlowStore.setState({ updateNodeData })
    const { rerender } = render(panel({ label: 'Before', stepType: 'scriptStep' }))
    expect(screen.getByDisplayValue('Before')).toBeTruthy()

    // Production ships `nodes` and `nodeDataRevision` in ONE store `set`, so the parent
    // (which derives `initialData` from `nodes`) and this panel's own revision subscription
    // update in the SAME React commit — bump the revision and re-render with the fresh data
    // together, inside one `act`, to match that.
    act(() => {
      useFlowStore.setState({ nodeDataRevision: 1 })
      rerender(panel({ label: 'After', stepType: 'scriptStep' }))
    })

    expect(await screen.findByDisplayValue('After')).toBeTruthy()
    await new Promise((r) => setTimeout(r, 400)) // past the 300 ms autosave debounce
    expect(updateNodeData).not.toHaveBeenCalled()
  })

  it("does not re-seed on the panel's own autosave round-trip (revision unchanged)", async () => {
    const { rerender } = render(panel({ label: 'Before', stepType: 'scriptStep' }))
    const input = screen.getByDisplayValue('Before')
    fireEvent.change(input, { target: { value: 'Typed' } })
    await new Promise((r) => setTimeout(r, 400)) // the 300 ms autosave fires (real updateNodeData writes to the empty store: no-op)
    // The store hands back the written data as a NEW initialData reference, revision unchanged.
    rerender(panel({ label: 'Typed', stepType: 'scriptStep' }))
    // A keystroke that lands after the round-trip must survive — a re-seed would clobber it.
    fireEvent.change(screen.getByDisplayValue('Typed'), { target: { value: 'Typed2' } })
    await new Promise((r) => setTimeout(r, 400))
    expect(screen.getByDisplayValue('Typed2')).toBeTruthy()
  })

  it('a bulk update that did not touch this node never lets the own-autosave round-trip clobber a pending keystroke', async () => {
    const { rerender } = render(panel({ label: 'Before', stepType: 'scriptStep' }))
    // "Update all" elsewhere: the revision bumps but this node's data (initialData) is unchanged.
    act(() => {
      useFlowStore.setState({ nodeDataRevision: 1 })
    })
    fireEvent.change(screen.getByDisplayValue('Before'), { target: { value: 'Typed' } })
    await new Promise((r) => setTimeout(r, 400)) // the panel's own autosave of 'Typed' fires
    // A newer keystroke lands while that write is still round-tripping through the store…
    fireEvent.change(screen.getByDisplayValue('Typed'), { target: { value: 'Typed2' } })
    // …and the store then hands back the written-back 'Typed' as a NEW initialData reference,
    // revision unchanged. A re-seed here would replace the draft with 'Typed'.
    rerender(panel({ label: 'Typed', stepType: 'scriptStep' }))
    expect(screen.getByDisplayValue('Typed2')).toBeTruthy()
  })
})
