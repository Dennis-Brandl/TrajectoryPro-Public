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

import { describe, it, expect } from 'vitest'
import { editorErrorMessage } from '@/lib/editorErrorMessage'
import { ApiError } from '@/stores/specificationStore/apiClient'

describe('editorErrorMessage', () => {
  it('maps known v2 codes from an ApiError', () => {
    expect(editorErrorMessage(new ApiError(403, 'forbidden', {}), 'x')).toMatch(/permission/i)
    expect(editorErrorMessage(new ApiError(409, 'edit_locked', {}), 'x')).toMatch(/locked/i)
    expect(editorErrorMessage(new ApiError(409, 'illegal_transition', {}), 'x')).toMatch(/state change/i)
    expect(editorErrorMessage(new ApiError(409, 'conflict', {}), 'x')).toMatch(/already in use/i)
  })

  it('maps a session-expiry 401 to sign-in copy, never the "deleted" scare', () => {
    const msg = editorErrorMessage(new ApiError(401, 'unauthenticated', {}), 'x')
    expect(msg).toMatch(/session has expired/i)
    expect(msg).not.toMatch(/deleted/i)
  })

  it('maps known codes from a plain { code } object (SaveError shape)', () => {
    expect(editorErrorMessage({ status: 403, code: 'forbidden', message: '' }, 'x')).toMatch(/permission/i)
    expect(editorErrorMessage({ status: 409, code: 'library_not_empty', message: '' }, 'x')).toMatch(/still contains/i)
  })

  it('explains still_changing', () => {
    expect(editorErrorMessage({ status: 0, code: 'still_changing', message: '' }, 'x')).toMatch(
      /try again, or discard/i,
    )
  })

  it('falls back for unknown codes / non-error values', () => {
    expect(editorErrorMessage(new ApiError(500, 'internal', {}), 'fallback')).toBe('fallback')
    expect(editorErrorMessage('boom', 'fallback')).toBe('fallback')
    expect(editorErrorMessage({ code: 'unknown' }, 'fallback')).toBe('fallback')
  })
})
