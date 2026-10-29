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
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/stores/specificationStore/saveScheduler', () => ({ flushNow: vi.fn() }))
vi.mock('@/hooks/useCanEditActiveSpec', () => ({ useCanEditActiveSpec: () => true }))
vi.mock('@/hooks/useIsChildWorkflow', () => ({ useIsChildWorkflow: () => false }))

import { CanvasToolbar } from '@/components/canvas/CanvasToolbar'
import { flushNow } from '@/stores/specificationStore/saveScheduler'
import { useLibraryStore } from '@/stores/libraryStore'

const setSelectedSpecification = vi.fn()

beforeEach(() => {
  vi.mocked(flushNow).mockReset()
  setSelectedSpecification.mockReset()
  useLibraryStore.setState({ setSelectedSpecification })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('CanvasToolbar Save & Close', () => {
  it('Save & Close stays open when the save fails', async () => {
    vi.mocked(flushNow).mockRejectedValue(new Error('save failed'))
    render(<CanvasToolbar />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(flushNow).toHaveBeenCalledTimes(1))
    await new Promise((r) => setTimeout(r, 0))
    expect(setSelectedSpecification).not.toHaveBeenCalled()
  })

  it('Save & Close closes after a successful save', async () => {
    vi.mocked(flushNow).mockResolvedValue(undefined)
    render(<CanvasToolbar />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(setSelectedSpecification).toHaveBeenCalledWith(null, null))
  })
})
