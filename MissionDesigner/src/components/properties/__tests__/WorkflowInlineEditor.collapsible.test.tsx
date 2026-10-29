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

import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { WorkflowInlineEditor } from '../WorkflowInlineEditor'
import { useFlowStore } from '@/stores/flowStore'
import { useLibraryStore } from '@/stores/libraryStore'

beforeEach(() => {
  useFlowStore.setState({
    nodes: [],
    edges: [],
    workflowInputs: [],
    workflowOutputs: [],
    workflowValues: [],
    workflowResources: [],
  })
  useLibraryStore.setState({ specifications: new Map(), selectedSpecificationId: null, selectedLibraryId: null })
})

describe('WorkflowInlineEditor collapsible sections', () => {
  it('renders all four section triggers, collapsed by default', () => {
    render(<WorkflowInlineEditor />)
    expect(screen.getByText('Input Parameters')).toBeTruthy()
    expect(screen.getByText('Output Parameters')).toBeTruthy()
    expect(screen.getByText('Value Properties')).toBeTruthy()
    expect(screen.getByText('Resource Definitions')).toBeTruthy()
    // Body content is collapsed/unmounted.
    expect(screen.queryByText('No inputs defined')).toBeNull()
  })

  it('expands the Input Parameters section when its trigger is clicked', () => {
    render(<WorkflowInlineEditor />)
    fireEvent.click(screen.getByText('Input Parameters'))
    expect(screen.getByText('No inputs defined')).toBeTruthy()
  })
})
