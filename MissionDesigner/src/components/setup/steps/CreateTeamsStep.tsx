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
import { createTeam, adminErrorMessage, type Team } from '@/lib/admin/adminClient'

const EXAMPLES = ['Engineering', 'Operations', 'Quality', 'Maintenance'] as const

export function CreateTeamsStep({
  teams,
  onTeamsChange,
  onNext,
  onBack,
}: {
  teams: Team[]
  onTeamsChange: (teams: Team[]) => void
  onNext: () => void
  onBack: () => void
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // An example chip adds its team in one click; the typed name is cleared only when it was the one added.
  const add = async (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) return
    setError(null)
    setBusy(true)
    try {
      const team = await createTeam({ name: trimmed })
      onTeamsChange([...teams, team])
      if (raw === name) setName('')
    } catch (err) {
      setError(adminErrorMessage(err, 'Could not create the team'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Create your team(s)</h2>
      <p className="text-sm text-muted-foreground">
        Teams own libraries and scope who can see and edit them. Create at least one.
      </p>
      <div className="space-y-2">
        <Label htmlFor="team-name">Team name</Label>
        <Input id="team-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <span className="text-xs text-muted-foreground self-center">Examples:</span>
        {EXAMPLES.filter((ex) => !teams.some((t) => t.name.toLowerCase() === ex.toLowerCase())).map((ex) => (
          <button
            key={ex}
            type="button"
            className="rounded-full border px-3 py-0.5 text-xs hover:bg-accent disabled:opacity-50"
            onClick={() => add(ex)}
            disabled={busy}
          >
            + {ex}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <Button type="button" variant="outline" onClick={() => add(name)} disabled={busy || !name.trim()}>
        + Add team
      </Button>
      <ul className="space-y-1">
        {teams.map((t) => (
          <li key={t.id} className="rounded border px-3 py-1.5 text-sm">
            {t.name}
          </li>
        ))}
      </ul>
      <div className="flex justify-between">
        <Button type="button" variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button type="button" onClick={onNext} disabled={teams.length === 0}>
          Continue
        </Button>
      </div>
    </div>
  )
}
