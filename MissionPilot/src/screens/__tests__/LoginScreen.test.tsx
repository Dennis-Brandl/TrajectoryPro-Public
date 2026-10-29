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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { LoginScreen } from '../LoginScreen'
import { useSession } from '../../session'
import { ApiError } from '../../api/client'
import { BrandLogoContext } from '../../frame/brand-logo'

vi.mock('../../session', () => ({ useSession: vi.fn() }))

describe('LoginScreen', () => {
  const signIn = vi.fn()
  const signOut = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useSession).mockReturnValue({ user: null, ready: true, signIn, signOut })
  })

  afterEach(cleanup)

  function fillAndSubmit(email: string, password: string) {
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))
  }

  it('renders Email, Password, and a Sign In button', () => {
    render(<LoginScreen />)
    expect(screen.getByLabelText('Email')).toBeTruthy()
    expect(screen.getByLabelText('Password')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeTruthy()
  })

  it('submits the typed email and password to signIn', async () => {
    signIn.mockResolvedValue(undefined)
    render(<LoginScreen />)

    fillAndSubmit('user@example.com', 'secret123')

    await waitFor(() => expect(signIn).toHaveBeenCalledWith('user@example.com', 'secret123'))
  })

  it('disables the Sign In button while the sign-in call is pending', async () => {
    let resolveSignIn: () => void = () => {}
    signIn.mockReturnValue(new Promise<void>((resolve) => { resolveSignIn = resolve }))
    render(<LoginScreen />)

    fillAndSubmit('user@example.com', 'secret123')

    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Sign In' }) as HTMLButtonElement).disabled).toBe(true)
    })

    resolveSignIn()

    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Sign In' }) as HTMLButtonElement).disabled).toBe(false)
    })
  })

  it('renders a role=alert with the fixed failure copy on ApiError and keeps the form', async () => {
    signIn.mockRejectedValue(new ApiError(401))
    render(<LoginScreen />)

    fillAndSubmit('user@example.com', 'wrong-password')

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Sign-in failed — check your email and password.')
    // the form is still present and usable
    expect(screen.getByLabelText('Email')).toBeTruthy()
    expect(screen.getByLabelText('Password')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Sign In' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows the disabled-account message when sign-in is refused with ACCOUNT_DISABLED', async () => {
    signIn.mockRejectedValue(new ApiError(403, 'ACCOUNT_DISABLED'))
    render(<LoginScreen />)

    fillAndSubmit('user@example.com', 'secret123')

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('This account is disabled. Ask an administrator to enable it.')
  })

  it('any other failure (even a 403 with another code) keeps the generic copy', async () => {
    signIn.mockRejectedValue(new ApiError(403, 'SOMETHING_ELSE'))
    render(<LoginScreen />)

    fillAndSubmit('user@example.com', 'secret123')

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Sign-in failed — check your email and password.')
  })

  it('429 says to wait a minute', async () => {
    signIn.mockRejectedValue(new ApiError(429))
    render(<LoginScreen />)
    fillAndSubmit('user@example.com', 'secret123')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Too many sign-in attempts. Wait a minute and try again.')
  })

  it('a 503 says the Mission Engine cannot be reached', async () => {
    signIn.mockRejectedValue(new ApiError(503))
    render(<LoginScreen />)
    fillAndSubmit('user@example.com', 'secret123')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe("Can't reach the Mission Engine. Check that it is running, then try again.")
  })

  it('a network failure (not an ApiError) says the Mission Engine cannot be reached', async () => {
    signIn.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<LoginScreen />)
    fillAndSubmit('user@example.com', 'secret123')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe("Can't reach the Mission Engine. Check that it is running, then try again.")
  })

  it('shows the splash until the site has a logo (spec §12)', () => {
    render(<LoginScreen />)
    expect(screen.getByRole('img', { name: 'Mission Pilot' })?.getAttribute('src')).toBe('/MissionPilotSplashScreen.png')
  })

  it('shows the site logo, 4 rem high, when the site theme has one (R5)', () => {
    const id = `sha256:${'a'.repeat(64)}`
    render(
      <BrandLogoContext.Provider value={{ logo: { id, mime: 'image/svg+xml', alt: 'Acme' }, logoDark: null }}>
        <LoginScreen />
      </BrandLogoContext.Provider>,
    )
    const img = screen.getByRole('img', { name: 'Acme' })
    expect(img?.getAttribute('src')).toBe(`/api/brand/${id}`)
    expect(img?.className.split(' ')).toEqual(expect.arrayContaining(['login-logo']))
  })

  it('a 401 from the post-sign-in session check says the session was not kept', async () => {
    signIn.mockRejectedValue(new ApiError(401, 'SESSION_NOT_KEPT'))
    render(<LoginScreen />)
    fillAndSubmit('user@example.com', 'secret123')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(
      'Signed in, but the session was not kept. Check that cookies are allowed for this site, then try again.',
    )
  })
})
