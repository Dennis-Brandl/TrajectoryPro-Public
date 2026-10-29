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
import { useNavigate } from '@tanstack/react-router'
import { Button } from '@mission/ui'
import { completeSetup, adminErrorMessage, type Team } from '@/lib/admin/adminClient'

export function ReviewStep({ teams, onBack }: { teams: Team[]; onBack: () => void }) {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const finish = async () => {
    setError(null)
    setBusy(true)
    try {
      await completeSetup()
      setDone(true) // swap to the splash immediately; boot continues underneath
      navigate({ to: '/' })
    } catch (err) {
      setError(adminErrorMessage(err, 'Could not finish setup'))
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="space-y-2 text-center">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Setting up your workspace…</h2>
        <p className="text-sm text-muted-foreground">Finishing setup and loading the editor.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Review &amp; finish</h2>
      <div className="text-sm">
        <div className="font-medium">Teams</div>
        <ul className="ml-4 list-disc text-muted-foreground">
          {teams.map((t) => (
            <li key={t.id}>{t.name}</li>
          ))}
        </ul>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="flex justify-between">
        <Button type="button" variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button type="button" onClick={finish} disabled={busy}>
          {busy ? 'Finishing…' : 'Finish'}
        </Button>
      </div>
    </div>
  )
}
