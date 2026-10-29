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

import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ResourceCommandEditor } from '../ResourceCommandEditor'
import { useFlowStore } from '@/stores/flowStore'
import { useLibraryStore } from '@/stores/libraryStore'

beforeEach(() => {
  // Empty stores → no resources available → empty-state branch renders.
  useFlowStore.setState({ nodes: [], edges: [], workflowResources: [] })
  useLibraryStore.setState({ specifications: new Map(), selectedSpecificationId: null })
})

describe('ResourceCommandEditor hideHeading', () => {
  it('shows the "Resource Commands" empty-state heading by default', () => {
    render(<ResourceCommandEditor resourceCommands={[]} onChange={vi.fn()} />)
    expect(screen.getByText('Resource Commands')).toBeTruthy()
  })

  it('hides the empty-state heading when hideHeading is set', () => {
    render(<ResourceCommandEditor resourceCommands={[]} onChange={vi.fn()} hideHeading />)
    expect(screen.queryByText('Resource Commands')).toBeNull()
    expect(screen.getByText(/No resources available/i)).toBeTruthy()
  })
})
