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
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CreateTeamsStep } from '../CreateTeamsStep'
import * as adminClient from '@/lib/admin/adminClient'

vi.mock('@/lib/admin/adminClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/admin/adminClient')>()
  return { ...actual, createTeam: vi.fn() }
})

beforeEach(() => {
  vi.mocked(adminClient.createTeam).mockImplementation(async ({ name }) => ({
    id: `team-${name}`,
    name,
    description: null,
    createdAt: 0,
    updatedAt: 0,
  }))
})
afterEach(() => vi.clearAllMocks())

describe('CreateTeamsStep', () => {
  it('creates a team, lists it, and enables Continue once >=1 exists', async () => {
    const onNext = vi.fn()
    render(<CreateTeamsStep teams={[]} onTeamsChange={vi.fn()} onNext={onNext} onBack={vi.fn()} />)
    // Continue disabled with zero teams
    expect(screen.getByRole('button', { name: /continue/i }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText(/team name/i), { target: { value: 'Engineering' } })
    fireEvent.click(screen.getByRole('button', { name: /add team/i }))
    await waitFor(() => expect(adminClient.createTeam).toHaveBeenCalledWith({ name: 'Engineering' }))
  })

  it('adds the team straight from an example chip, leaving a typed name alone', async () => {
    const onTeamsChange = vi.fn()
    render(<CreateTeamsStep teams={[]} onTeamsChange={onTeamsChange} onNext={vi.fn()} onBack={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/team name/i), { target: { value: 'Half typed' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Operations' }))
    await waitFor(() => expect(adminClient.createTeam).toHaveBeenCalledWith({ name: 'Operations' }))
    await waitFor(() => expect(onTeamsChange).toHaveBeenCalledWith([expect.objectContaining({ name: 'Operations' })]))
    expect((screen.getByLabelText(/team name/i) as HTMLInputElement).value).toBe('Half typed')
  })

  it('creates every team in a comma-separated list, in order, skipping ones that exist', async () => {
    const onTeamsChange = vi.fn()
    const existing = { id: 't1', name: 'Quality', description: null, createdAt: 0, updatedAt: 0 }
    render(<CreateTeamsStep teams={[existing]} onTeamsChange={onTeamsChange} onNext={vi.fn()} onBack={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/team name/i), {
      target: { value: 'Engineering, quality,, Line 2 ,Engineering' },
    })
    fireEvent.click(screen.getByRole('button', { name: /add team/i }))
    await waitFor(() =>
      expect(onTeamsChange).toHaveBeenLastCalledWith([
        existing,
        expect.objectContaining({ name: 'Engineering' }),
        expect.objectContaining({ name: 'Line 2' }),
      ]),
    )
    expect(vi.mocked(adminClient.createTeam).mock.calls.map((c) => c[0])).toEqual([
      { name: 'Engineering' },
      { name: 'Line 2' },
    ])
    expect((screen.getByLabelText(/team name/i) as HTMLInputElement).value).toBe('')
  })

  it('on a failure keeps the teams made and leaves the failed name and the rest in the box', async () => {
    vi.mocked(adminClient.createTeam)
      .mockResolvedValueOnce({ id: 'a', name: 'A', description: null, createdAt: 0, updatedAt: 0 })
      .mockRejectedValueOnce(new Error('boom'))
    const onTeamsChange = vi.fn()
    render(<CreateTeamsStep teams={[]} onTeamsChange={onTeamsChange} onNext={vi.fn()} onBack={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/team name/i), { target: { value: 'A, B, C' } })
    fireEvent.click(screen.getByRole('button', { name: /add team/i }))
    expect(await screen.findByText(/Could not create "B"/)).toBeTruthy()
    expect(onTeamsChange).toHaveBeenCalledTimes(1)
    expect(onTeamsChange).toHaveBeenCalledWith([expect.objectContaining({ name: 'A' })])
    expect((screen.getByLabelText(/team name/i) as HTMLInputElement).value).toBe('B, C')
    expect(adminClient.createTeam).toHaveBeenCalledTimes(2)
  })

  it('hides the chip for a team that already exists', () => {
    const existing = { id: 't1', name: 'quality', description: null, createdAt: 0, updatedAt: 0 }
    render(<CreateTeamsStep teams={[existing]} onTeamsChange={vi.fn()} onNext={vi.fn()} onBack={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '+ Quality' })).toBeNull()
    expect(screen.getByRole('button', { name: '+ Engineering' })).toBeTruthy()
  })
})
