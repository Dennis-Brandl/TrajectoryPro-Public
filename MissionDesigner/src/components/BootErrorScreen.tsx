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

import { useEffect, useRef, useState } from 'react'
import { Button } from '@mission/ui'

interface BootErrorScreenProps {
  detail?: string
  onRetry: () => Promise<unknown> | void
  onSignOut: () => void
}

// Shown when the account check (/me) fails for a reason other than "not signed
// in", so the operator sees the real cause instead of looping through sign-in.
export function BootErrorScreen({ detail, onRetry, onSignOut }: BootErrorScreenProps) {
  const [retrying, setRetrying] = useState(false)
  const [failedAt, setFailedAt] = useState<string | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const handleRetry = async () => {
    setRetrying(true)
    try {
      await onRetry()
    } catch {
      // still failing: reported below
    }
    if (!mounted.current) return
    setRetrying(false)
    setFailedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
  }

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
      <div className="max-w-md w-full mx-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Mission Designer can't load your account right now.
        </h1>
        {detail && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{detail}</p>}
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Press Retry. If it keeps failing, check that the server is running, or sign out and sign in again.
        </p>
        <div className="mt-4 flex gap-2">
          <Button onClick={() => void handleRetry()} disabled={retrying}>
            {retrying ? 'Retrying…' : 'Retry'}
          </Button>
          <Button variant="outline" onClick={onSignOut}>
            Sign out
          </Button>
        </div>
        {failedAt && (
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{`Still failing (checked at ${failedAt}).`}</p>
        )}
      </div>
    </div>
  )
}
