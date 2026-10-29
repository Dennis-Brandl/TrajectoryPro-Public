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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { SignInScreen } from './SignInScreen'
import { clearApiKey, getApiKey } from '@/lib/apiKey'

const FAKE_KEY = 'test-key-0123456789abcdef0123456789abcdef'

function submitKey() {
  fireEvent.change(screen.getByLabelText('API key'), { target: { value: FAKE_KEY } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('SignInScreen', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    clearApiKey()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stores the key and signs in on 200', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
    const onSignedIn = vi.fn()
    render(<SignInScreen onSignedIn={onSignedIn} />)
    submitKey()
    await waitFor(() => expect(onSignedIn).toHaveBeenCalled())
    expect(getApiKey()).toBe(FAKE_KEY)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(new Headers(init.headers).get('X-API-Key')).toBe(FAKE_KEY)
  })

  it('shows the rejected message on 401 and stores nothing', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }))
    const onSignedIn = vi.fn()
    render(<SignInScreen onSignedIn={onSignedIn} />)
    submitKey()
    expect(
      await screen.findByText('That key was not accepted. Check ACTIONS_API_KEY in .env.')
    ).toBeTruthy()
    expect(getApiKey()).toBeNull()
    expect(onSignedIn).not.toHaveBeenCalled()
  })

  it('shows the not-responding message when fetch fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<SignInScreen onSignedIn={vi.fn()} />)
    submitKey()
    expect(
      await screen.findByText(
        'Mission Autopilot is not responding. Check that its server is running.'
      )
    ).toBeTruthy()
    expect(getApiKey()).toBeNull()
  })
})
