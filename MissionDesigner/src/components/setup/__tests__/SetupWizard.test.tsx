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

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SetupWizard } from '../SetupWizard'
import * as setupClient from '@/lib/setupClient'
import * as adminClient from '@/lib/admin/adminClient'

vi.mock('@/lib/setupClient', () => ({ getSetupStatus: vi.fn() }))
vi.mock('@/lib/admin/adminClient', () => ({ listTeams: vi.fn() }))
// Stub the heavy step children to isolate the container's flow.
vi.mock('../steps/WelcomeStep', () => ({
  WelcomeStep: ({ onNext }: { onNext: () => void }) => <button onClick={onNext}>welcome-next</button>,
}))
vi.mock('../steps/CreateAdminStep', () => ({
  CreateAdminStep: ({ onCreated }: { onCreated: () => void }) => <button onClick={onCreated}>admin-next</button>,
}))
vi.mock('../steps/CreateTeamsStep', () => ({
  CreateTeamsStep: ({ onNext, teams }: { onNext: () => void; teams: { name: string }[] }) => (
    <button onClick={onNext}>teams-next [{teams.map((t) => t.name).join(',')}]</button>
  ),
}))
vi.mock('../steps/ChooseRolesStep', () => ({
  ChooseRolesStep: ({ onNext }: { onNext: () => void }) => <button onClick={onNext}>roles-next</button>,
}))
vi.mock('../steps/ReviewStep', () => ({ ReviewStep: () => <div>review-step</div> }))

afterEach(() => vi.clearAllMocks())

describe('SetupWizard', () => {
  it('runs welcome → admin → teams → roles → review on a fresh DB (no admin)', async () => {
    vi.mocked(setupClient.getSetupStatus).mockResolvedValue({ setupComplete: false, hasAdmin: false })
    render(<SetupWizard />)
    fireEvent.click(await screen.findByText('welcome-next'))
    fireEvent.click(await screen.findByText('admin-next'))
    fireEvent.click(await screen.findByText(/teams-next/))
    fireEvent.click(await screen.findByText('roles-next'))
    expect(await screen.findByText('review-step')).toBeTruthy()
  })

  it('resumes at the teams step when an admin already exists', async () => {
    vi.mocked(setupClient.getSetupStatus).mockResolvedValue({ setupComplete: false, hasAdmin: true })
    render(<SetupWizard />)
    expect(await screen.findByText(/teams-next/)).toBeTruthy()
    expect(screen.queryByText('welcome-next')).toBeNull()
    expect(screen.queryByText('admin-next')).toBeNull()
  })

  it('a reload mid-setup shows the teams already created (not GLOBAL), so Continue is not stuck', async () => {
    vi.mocked(setupClient.getSetupStatus).mockResolvedValue({ setupComplete: false, hasAdmin: true })
    const team = (id: string, name: string) => ({
      id,
      name,
      description: null,
      createdAt: 0,
      updatedAt: 0,
      memberCount: 0,
      libraryCount: 0,
    })
    vi.mocked(adminClient.listTeams).mockResolvedValue([team('team-global', 'GLOBAL'), team('t1', 'Engineering')])
    render(<SetupWizard />)
    expect(await screen.findByText('teams-next [Engineering]')).toBeTruthy()
  })

  it('still resumes (with no teams) when the team list cannot be read', async () => {
    vi.mocked(setupClient.getSetupStatus).mockResolvedValue({ setupComplete: false, hasAdmin: true })
    vi.mocked(adminClient.listTeams).mockRejectedValue(new Error('401'))
    render(<SetupWizard />)
    expect(await screen.findByText('teams-next []')).toBeTruthy()
  })
})
