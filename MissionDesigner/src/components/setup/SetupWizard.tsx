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

import { useEffect, useState } from 'react'
import { getSetupStatus } from '@/lib/setupClient'
import { listTeams, type Team } from '@/lib/admin/adminClient'
import { GLOBAL_TEAM_ID } from '@/lib/global-team'
import { WelcomeStep } from './steps/WelcomeStep'
import { CreateAdminStep } from './steps/CreateAdminStep'
import { CreateTeamsStep } from './steps/CreateTeamsStep'
import { ChooseRolesStep } from './steps/ChooseRolesStep'
import { ReviewStep } from './steps/ReviewStep'

type Step = 'welcome' | 'admin' | 'teams' | 'roles' | 'review'
const ORDER: Step[] = ['welcome', 'admin', 'teams', 'roles', 'review']

export function SetupWizard() {
  const [step, setStep] = useState<Step | null>(null) // null = still resolving resume point
  const [teams, setTeams] = useState<Team[]>([])

  useEffect(() => {
    let active = true
    getSetupStatus()
      .then(async (s) => {
        if (!s.hasAdmin) return active && setStep('welcome')
        // A reload mid-setup: the teams created before it are in the database but not in this
        // page's memory. Show them, or the step reads as empty, re-adding one says "already in
        // use", and Continue stays disabled. Unreadable list = resume with none, as before.
        let existing: Team[] = []
        try {
          const listed = await listTeams()
          if (Array.isArray(listed)) existing = listed.filter((t) => t.id !== GLOBAL_TEAM_ID)
        } catch {
          // resume with none
        }
        if (!active) return
        setTeams(existing)
        setStep('teams')
      })
      .catch(() => active && setStep('welcome'))
    return () => {
      active = false
    }
  }, [])

  const go = (s: Step) => setStep(s)

  return (
    <div className="setup-bg min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-xl rounded-lg border bg-card p-8 shadow-sm">
        {step === null && <p className="text-sm text-muted-foreground">Loading…</p>}
        {step === 'welcome' && <WelcomeStep onNext={() => go('admin')} />}
        {step === 'admin' && <CreateAdminStep onCreated={() => go('teams')} />}
        {step === 'teams' && (
          <CreateTeamsStep
            teams={teams}
            onTeamsChange={setTeams}
            onNext={() => go('roles')}
            onBack={() => go('admin')}
          />
        )}
        {step === 'roles' && <ChooseRolesStep onNext={() => go('review')} onBack={() => go('teams')} />}
        {step === 'review' && <ReviewStep teams={teams} onBack={() => go('roles')} />}
        {step !== null && (
          <div className="mt-6 text-center text-xs text-muted-foreground">
            Step {Math.max(1, ORDER.indexOf(step) + 1)} of {ORDER.length}
          </div>
        )}
      </div>
    </div>
  )
}
