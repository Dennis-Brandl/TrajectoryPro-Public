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
import { Button, Input, Label, SignInFrame } from '@mission/ui'
import { setApiKey } from '@/lib/apiKey'

export const REJECTED = 'That key was not accepted. Check ACTIONS_API_KEY in .env.'
const DESCRIPTION =
  'Execution system for Environment Actions, with code written in Python. ' +
  'Supports Opaque and Observable actions, with execution logs and Action Instance visibility.'
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
    <SignInFrame
      splashSrc="/MissionAutopilotSplashScreen.png"
      splashAlt="Mission Autopilot"
      description={DESCRIPTION}
    >
      <form
        onSubmit={(e) => void submit(e)}
        className="w-80 space-y-4 rounded-[10px] border border-border p-6"
      >
        <h1 className="text-lg font-semibold">Sign in</h1>
        <div className="space-y-1.5">
          <Label htmlFor="api-key">API key</Label>
          <Input
            id="api-key"
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            The key is ACTIONS_API_KEY in the .env file next to docker-compose.yml.
          </p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={checking || key.trim() === ''}>
          Sign in
        </Button>
      </form>
    </SignInFrame>
  )
}
