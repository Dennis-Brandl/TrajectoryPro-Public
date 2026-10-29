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

import { useState, useEffect } from 'react'
import { createFileRoute, useNavigate, redirect } from '@tanstack/react-router'
import { useSession } from '@/lib/auth-client'
import { getSetupStatus } from '@/lib/setupClient'
import { LoginForm } from '@/components/auth/LoginForm'

export function LoginPage() {
  const [healthError, setHealthError] = useState<string | null>(null)
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()

  // Check server/database connectivity on mount
  useEffect(() => {
    fetch('/api/health')
      .then((res) => {
        if (!res.ok)
          return res.json().then((data) => {
            throw new Error(data.message || 'Server error')
          })
        return res.json()
      })
      .then((data) => {
        if (data.status !== 'ok') {
          setHealthError('Database connection failed. Please contact your system administrator.')
        } else {
          setHealthError(null)
        }
      })
      .catch(() => {
        setHealthError('Unable to connect to the server. Please contact your system administrator.')
      })
  }, [])

  // Redirect to app if user already has a valid session
  useEffect(() => {
    if (session && !isPending) {
      navigate({ to: '/' })
    }
  }, [session, isPending, navigate])

  // Show the splash while the session is still being checked (isPending) AND
  // while a valid session is redirecting to the app (session truthy). The latter
  // matters because the client-side post-login navigation keeps THIS route
  // mounted until the authenticated route's async beforeLoad (getMe +
  // loadLibraries) resolves — rendering null there shows a blank page for the
  // whole transition (and any redirect bounce). Show the splash, never blank.
  if (isPending || session) {
    return (
      <div className="login-bg min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          {/* w-64, not a fixed height: the splash art is ~1.42:1, so sizing it by
              height shrinks it to a strip too narrow to read the product name. */}
          <img src="/MissionDesignerSplashScreen.png" alt="Mission Designer" className="w-64 h-auto rounded-lg" />
          <p className="text-xs text-[#F4F1DE]/50">Copyright 2026 Dennis L. Brandl · Apache License 2.0</p>
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-white/10 border-t-[#D4AF37]" />
          <span className="text-sm text-[#F4F1DE]/60">Loading...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="login-bg min-h-screen flex items-center justify-center">
      <div className="login-card relative w-full max-w-md p-8 space-y-6">
        <div className="text-center">
          <img
            src="/MissionDesignerSplashScreen.png"
            alt="Mission Designer"
            className="mx-auto w-full max-w-sm h-auto rounded-lg"
          />
          <p className="mt-3 text-xs text-[#F4F1DE]/50">Copyright 2026 Dennis L. Brandl · Apache License 2.0</p>
          <p className="mt-4 text-sm text-[#F4F1DE]/60">
            Design and manage workflows, procedures, recipes, and batch processes. Author step-by-step specifications
            for Trajectory Pro Mission Control runtime environments.
          </p>
          <p className="mt-4 text-[#F4F1DE]/80">Sign in to your account</p>
        </div>

        {healthError ? (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-4 text-center">
            <p className="text-sm font-medium text-red-300">{healthError}</p>
          </div>
        ) : (
          <LoginForm />
        )}
      </div>
    </div>
  )
}

export const Route = createFileRoute('/login')({
  beforeLoad: async () => {
    // A fresh install (no admin) has nothing to log into — send to the wizard.
    let status
    try {
      status = await getSetupStatus()
    } catch {
      return
    }
    if (!status.setupComplete) throw redirect({ to: '/setup' })
  },
  component: LoginPage,
})
