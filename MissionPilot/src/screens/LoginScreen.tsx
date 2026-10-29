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
import { useState, type FormEvent } from 'react'
import { useSession } from '../session'
import { BrandLogo } from '../frame/brand-logo'
import { useAppTitle } from '../frame/app-title'
import { ApiError } from '../api/client'

// ApiError code signIn() throws when the post-sign-in /me is refused (see session.tsx).
const SESSION_NOT_KEPT = 'SESSION_NOT_KEPT'

// Same text as mission-control-db's ACCOUNT_DISABLED_MESSAGE (Pilot imports types only, so it is inlined).
const ACCOUNT_DISABLED_MESSAGE = 'This account is disabled. Ask an administrator to enable it.'
const SIGN_IN_FAILED_MESSAGE = 'Sign-in failed — check your email and password.'
const RATE_LIMITED_MESSAGE = 'Too many sign-in attempts. Wait a minute and try again.'
const ENGINE_UNREACHABLE_MESSAGE = "Can't reach the Mission Engine. Check that it is running, then try again."

const SESSION_NOT_KEPT_MESSAGE =
  'Signed in, but the session was not kept. Check that cookies are allowed for this site, then try again.'

function messageFor(err: unknown): string {
  if (!(err instanceof ApiError) || err.status >= 500) return ENGINE_UNREACHABLE_MESSAGE
  if (err.code === SESSION_NOT_KEPT) return SESSION_NOT_KEPT_MESSAGE
  if (err.code === 'ACCOUNT_DISABLED') return ACCOUNT_DISABLED_MESSAGE
  if (err.status === 429) return RATE_LIMITED_MESSAGE
  return SIGN_IN_FAILED_MESSAGE
}

export function LoginScreen() {
  const { signIn } = useSession()
  const appTitle = useAppTitle()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setMessage(null)
    setPending(true)
    try {
      await signIn(email, password)
    } catch (err) {
      setMessage(messageFor(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="login-screen">
      {/* Spec §12 / R5: the site logo (the theme served without sign-in); the splash until there is one. */}
      <BrandLogo
        className="login-logo"
        fallbackClassName="login-splash"
        fallbackSrc="/MissionPilotSplashScreen.png"
        fallbackAlt="Mission Pilot"
        logoAlt={appTitle}
      />
      <p className="login-copyright">Copyright 2026 Dennis L. Brandl · Apache License 2.0</p>

      <form onSubmit={onSubmit}>
        <label htmlFor="cockpit-login-email">Email</label>
        <input
          id="cockpit-login-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={pending}
          autoComplete="username"
          required
        />

        <label htmlFor="cockpit-login-password">Password</label>
        <input
          id="cockpit-login-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={pending}
          autoComplete="current-password"
          required
        />

        {message && <p role="alert">{message}</p>}

        <button type="submit" disabled={pending}>
          Sign In
        </button>
      </form>
    </div>
  )
}
