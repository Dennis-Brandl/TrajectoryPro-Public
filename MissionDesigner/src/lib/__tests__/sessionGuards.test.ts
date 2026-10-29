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

import { describe, it, expect, vi } from 'vitest'
import { signOutQuietly, getSessionOrUnreachable } from '../sessionGuards'

describe('signOutQuietly', () => {
  it('resolves when signOut rejects (server unreachable)', async () => {
    await expect(signOutQuietly(() => Promise.reject(new Error('Failed to fetch')))).resolves.toBeUndefined()
  })
  it('calls signOut', async () => {
    const f = vi.fn().mockResolvedValue(undefined)
    await signOutQuietly(f)
    expect(f).toHaveBeenCalledTimes(1)
  })
})

describe('getSessionOrUnreachable', () => {
  it('returns unreachable when getSession throws', async () => {
    const r = await getSessionOrUnreachable(() => Promise.reject(new Error('Failed to fetch')))
    expect(r).toEqual({ unreachable: true })
  })
  it('returns the session data otherwise', async () => {
    const r = await getSessionOrUnreachable(() => Promise.resolve({ data: { user: { id: 'u' } } }))
    expect(r).toEqual({ unreachable: false, data: { user: { id: 'u' } } })
  })
})
