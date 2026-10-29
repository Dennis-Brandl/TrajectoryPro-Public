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
import { stashPendingRetry, clearPendingRetry, isSessionExpiryError } from '../specificationStore/sessionExpiry'
import { ApiError } from '../specificationStore/apiClient'
import { useSpecificationStore } from '../specificationStore'

beforeEach(() => useSpecificationStore.getState()._reset())

describe('sessionExpiry', () => {
  it('detects a 401 ApiError as session expiry', () => {
    expect(isSessionExpiryError(new ApiError(401, 'not_found', {}))).toBe(true)
    expect(isSessionExpiryError(new ApiError(500, 'internal', {}))).toBe(false)
    expect(isSessionExpiryError(new Error('unrelated'))).toBe(false)
  })

  it('stashPendingRetry clears savingIds and populates pendingRetryIds', () => {
    useSpecificationStore.setState((s) => {
      s.savingIds.add('r')
    })
    stashPendingRetry(['r'])
    const s = useSpecificationStore.getState()
    expect(s.savingIds.has('r')).toBe(false)
    expect(s.pendingRetryIds.has('r')).toBe(true)
  })

  it('clearPendingRetry empties the set', () => {
    useSpecificationStore.setState((s) => {
      s.pendingRetryIds.add('r')
    })
    clearPendingRetry()
    expect(useSpecificationStore.getState().pendingRetryIds.size).toBe(0)
  })
})
