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
import { renderHook } from '@testing-library/react'
import { useCopyPaste } from '@/hooks/useCopyPaste'
import { useCanEditActiveSpec } from '@/hooks/useCanEditActiveSpec'
import { useFlowStore } from '@/stores/flowStore'

vi.mock('@/hooks/useCanEditActiveSpec', () => ({ useCanEditActiveSpec: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  useFlowStore.setState({ nodes: [], edges: [] })
})

describe('useCopyPaste read-only', () => {
  it('Delete key is a no-op when read-only', () => {
    vi.mocked(useCanEditActiveSpec).mockReturnValue(false)
    const del = vi.spyOn(useFlowStore.getState(), 'deleteSelectedNodes')
    renderHook(() => useCopyPaste())
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }))
    expect(del).not.toHaveBeenCalled()
  })

  it('Delete key deletes when editable', () => {
    vi.mocked(useCanEditActiveSpec).mockReturnValue(true)
    const del = vi.spyOn(useFlowStore.getState(), 'deleteSelectedNodes')
    renderHook(() => useCopyPaste())
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }))
    expect(del).toHaveBeenCalled()
  })
})
