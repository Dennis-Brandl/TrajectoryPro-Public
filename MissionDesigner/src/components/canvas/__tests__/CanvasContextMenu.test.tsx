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

import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CanvasContextMenu } from '@/components/canvas/CanvasContextMenu'
import { useFlowStore } from '@/stores/flowStore'

const pos = { x: 10, y: 10 }

beforeEach(() => {
  useFlowStore.setState({ nodes: [], edges: [] })
})

describe('CanvasContextMenu read-only gating', () => {
  it('node menu hides Edit/Duplicate/Delete when read-only, keeps Copy', () => {
    render(<CanvasContextMenu position={pos} type="node" targetId="n1" onClose={() => {}} canEdit={false} />)
    expect(screen.getByText('Copy')).not.toBeNull()
    expect(screen.queryByText('Edit')).toBeNull()
    expect(screen.queryByText('Duplicate')).toBeNull()
    expect(screen.queryByText('Delete')).toBeNull()
  })

  it('node menu shows Duplicate + Delete when editable', () => {
    render(<CanvasContextMenu position={pos} type="node" targetId="n1" onClose={() => {}} canEdit />)
    expect(screen.getByText('Duplicate')).not.toBeNull()
    expect(screen.getByText('Delete')).not.toBeNull()
  })

  it('pane menu hides Paste when read-only, keeps Select All', () => {
    render(<CanvasContextMenu position={pos} type="pane" onClose={() => {}} canEdit={false} />)
    expect(screen.getByText('Select All')).not.toBeNull()
    expect(screen.queryByText('Paste')).toBeNull()
  })

  it('edge menu hides Delete and shows a Read-only note when read-only', () => {
    render(<CanvasContextMenu position={pos} type="edge" targetId="e1" onClose={() => {}} canEdit={false} />)
    expect(screen.queryByText('Delete')).toBeNull()
    expect(screen.getByText(/read-only/i)).not.toBeNull()
  })

  it('pane menu offers Convert buttons only when editable', () => {
    const { unmount } = render(<CanvasContextMenu position={pos} type="pane" onClose={() => {}} canEdit />)
    expect(screen.getByText('Convert buttons in all forms...')).not.toBeNull()
    unmount()
    render(<CanvasContextMenu position={pos} type="pane" onClose={() => {}} canEdit={false} />)
    expect(screen.queryByText('Convert buttons in all forms...')).toBeNull()
  })
})
