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
import { render, screen } from '@testing-library/react'

const sessionState = vi.fn()
vi.mock('@/lib/auth-client', () => ({ useSession: () => sessionState() }))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: unknown) => ({ options: opts }),
  useNavigate: () => vi.fn(),
}))
vi.mock('@/components/auth/LoginForm', () => ({ LoginForm: () => <form data-testid="login-form" /> }))

import { LoginPage } from '@/routes/login'

beforeEach(() => {
  sessionState.mockReset()
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok' }) })),
  )
})

describe('LoginPage', () => {
  it('renders the loading splash (never a blank page) while a valid session redirects to the app', () => {
    // After sign-in the session is truthy and the route stays mounted during the
    // authenticated route's async beforeLoad — it must show the splash, not blank.
    sessionState.mockReturnValue({ data: { user: { id: 'u1' } }, isPending: false })
    const { container } = render(<LoginPage />)
    expect(container.innerHTML).not.toBe('')
    expect(screen.getByText(/loading/i)).toBeTruthy()
    expect(screen.queryByTestId('login-form')).toBeNull()
  })

  it('renders the login form when there is no session', () => {
    sessionState.mockReturnValue({ data: null, isPending: false })
    render(<LoginPage />)
    expect(screen.getByTestId('login-form')).toBeTruthy()
  })

  it('renders the splash while the session is still pending', () => {
    sessionState.mockReturnValue({ data: null, isPending: true })
    render(<LoginPage />)
    expect(screen.getByText(/loading/i)).toBeTruthy()
  })
})
