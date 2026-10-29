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
import { render } from '@testing-library/react'
import { toast } from 'sonner'
import { SaveErrorToast } from '@/components/dialogs/SaveErrorToast'
import { LibrarySaveErrorToast } from '@/components/dialogs/LibrarySaveErrorToast'
import { useSpecificationStore } from '@/stores/specificationStore'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

beforeEach(() => {
  vi.clearAllMocks()
  useSpecificationStore.setState({ lastSaveError: null, lastLibrarySaveError: null })
})

describe('SaveErrorToast', () => {
  it('renders a friendly message for a known code (edit_locked)', () => {
    render(<SaveErrorToast />)
    useSpecificationStore.setState({ lastSaveError: { status: 409, code: 'edit_locked', message: '409 edit_locked' } })
    render(<SaveErrorToast />)
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(expect.stringMatching(/locked/i), expect.any(Object))
  })
})

describe('LibrarySaveErrorToast', () => {
  it('renders a friendly message for library_not_empty', () => {
    useSpecificationStore.setState({
      lastLibrarySaveError: { status: 409, code: 'library_not_empty', message: '409 library_not_empty' },
    })
    render(<LibrarySaveErrorToast />)
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(expect.stringMatching(/still contains/i), expect.any(Object))
  })
})
