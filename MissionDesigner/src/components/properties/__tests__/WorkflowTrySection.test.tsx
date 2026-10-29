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

import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { WorkflowInlineEditor } from '../WorkflowInlineEditor'
import { useFlowStore } from '@/stores/flowStore'
import { useLibraryStore } from '@/stores/libraryStore'
import { findCatchTriggers } from '@/lib/canvas/findCatchTriggers'
import type { WorkflowNode } from '@/types/nodes'

const catchNode = {
  id: 'c1',
  type: 'catch',
  position: { x: 0, y: 0 },
  data: { label: 'Recover', stepType: 'catch', catchId: 'C1' },
} as unknown as WorkflowNode

beforeEach(() => {
  useFlowStore.setState({
    nodes: [],
    edges: [],
    workflowInputs: [],
    workflowOutputs: [],
    workflowValues: [],
    workflowResources: [],
    workflowTrySpecifications: [],
  })
  useLibraryStore.setState({ specifications: new Map(), selectedSpecificationId: null, selectedLibraryId: null })
})

describe('WorkflowInlineEditor TRY / Error Handling section', () => {
  it('adds a TRY row and auto-saves it to the store after the debounce', async () => {
    useFlowStore.setState({ nodes: [catchNode] })
    render(<WorkflowInlineEditor />)

    expect(screen.getByText('TRY / Error Handling')).toBeTruthy()
    fireEvent.click(screen.getByText('TRY / Error Handling'))
    fireEvent.click(screen.getByText('+ Add TRY'))

    await act(async () => {
      await new Promise((r) => setTimeout(r, 350))
    })

    expect(useFlowStore.getState().workflowTrySpecifications).toEqual([
      { mode: 'ERROR', catch_id: 'C1', release_on_catch: true },
    ])
  })

  it('disables + Add TRY when there are no CATCH nodes', () => {
    render(<WorkflowInlineEditor />)
    fireEvent.click(screen.getByText('TRY / Error Handling'))
    const btn = screen.getByRole('button', { name: /Add TRY/i }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })
})

describe('findCatchTriggers — workflow-level rows', () => {
  it('yields a Workflow row for a matching workflow-level TRY', () => {
    expect(findCatchTriggers([], 'C1', [{ mode: 'ERROR', catch_id: 'C1' }])).toEqual([
      { stepId: '', stepLabel: 'Workflow', mode: 'ERROR' },
    ])
  })

  it('returns [] for a non-matching workflow-level catch id', () => {
    expect(findCatchTriggers([], 'C1', [{ mode: 'ERROR', catch_id: 'OTHER' }])).toEqual([])
  })
})
