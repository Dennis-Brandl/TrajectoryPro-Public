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

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import App from './App'
import { clearApiKey, setApiKey, UNAUTHORIZED_EVENT } from '@/lib/apiKey'

const REJECTED_TEXT = 'That key was not accepted. Check ACTIONS_API_KEY in .env.'

describe('App sign-in state', () => {
  beforeEach(() => {
    setApiKey('test-key-0123456789abcdef0123456789abcdef')
  })
  afterEach(() => {
    clearApiKey()
  })

  function renderApp() {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    )
  }

  it('shows the splash before the sign-in screen, not after it', () => {
    clearApiKey()
    renderApp()
    expect(screen.getByAltText('Mission Autopilot')).toBeTruthy()
    expect(screen.queryByLabelText('API key')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByLabelText('API key')).toBeTruthy()
    expect(screen.queryByAltText('Mission Autopilot')).toBeNull()
  })

  it('shows the rejected message after a mid-session 401', () => {
    renderApp()
    expect(screen.queryByLabelText('API key')).toBeNull()
    act(() => {
      clearApiKey()
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    })
    expect(screen.getByLabelText('API key')).toBeTruthy()
    expect(screen.getByText(REJECTED_TEXT)).toBeTruthy()
  })

  it('shows a blank form after an explicit sign out', () => {
    renderApp()
    act(() => {
      clearApiKey()
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: { signOut: true } }))
    })
    expect(screen.getByLabelText('API key')).toBeTruthy()
    expect(screen.queryByText(REJECTED_TEXT)).toBeNull()
  })
})
