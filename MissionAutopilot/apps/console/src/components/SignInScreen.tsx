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

import { useState } from 'react'
import { Button, Input, Label } from '@mission/ui'
import { setApiKey } from '@/lib/apiKey'

export const REJECTED = 'That key was not accepted. Check ACTIONS_API_KEY in .env.'
const NOT_RESPONDING = 'Mission Autopilot is not responding. Check that its server is running.'

export function SignInScreen({
  onSignedIn,
  initialError = null,
}: {
  onSignedIn: () => void
  /** Shown on first render, e.g. when a mid-session 401 sent the user back here. */
  initialError?: string | null
}) {
  const [key, setKey] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(initialError)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const candidate = key.trim()
    setChecking(true)
    setError(null)
    try {
      const res = await fetch('/management/v1/settings', {
        headers: { 'X-API-Key': candidate },
      })
      if (res.ok) {
        setApiKey(candidate)
        onSignedIn()
        return
      }
      setError(res.status === 401 ? REJECTED : NOT_RESPONDING)
    } catch {
      setError(NOT_RESPONDING)
    }
    setChecking(false)
  }

  return (
    <div className="fixed inset-0 min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-slate-900 via-slate-950 to-black">
      <form
        onSubmit={(e) => void submit(e)}
        className="w-full max-w-md space-y-4 rounded-2xl border border-amber-500/20 bg-slate-900/85 p-8 shadow-2xl"
      >
        <h1 className="text-xl font-semibold text-slate-100">Sign in to Mission Autopilot</h1>
        <div className="space-y-1.5">
          <Label htmlFor="api-key" className="text-slate-200">
            API key
          </Label>
          <Input
            id="api-key"
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
            autoFocus
          />
          <p className="text-xs text-slate-400">
            The key is ACTIONS_API_KEY in the .env file next to docker-compose.yml.
          </p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
        <Button type="submit" disabled={checking || key.trim() === ''}>
          Sign in
        </Button>
      </form>
    </div>
  )
}
