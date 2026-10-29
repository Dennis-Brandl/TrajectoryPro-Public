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
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { WorkCenterPicker } from '../WorkCenterPicker'
import { api } from '../../api/client'
import type { WorkCenter } from '../../api/types'

vi.mock('../../api/client', () => ({
  api: { workCenters: vi.fn() },
}))

const wcs: WorkCenter[] = [
  { id: 'wc1', name: 'Assembly', path: [], openTasks: 0 },
  { id: 'wc2', name: 'Line 2', path: ['Plant', 'Mixing'], openTasks: 3 },
]

describe('WorkCenterPicker (spec §5.5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(cleanup)

  it('each work center is a card named just by the work center, its path and open-task count describing it', async () => {
    vi.mocked(api.workCenters).mockResolvedValue(wcs)
    render(<WorkCenterPicker onSelect={vi.fn()} onSignOut={vi.fn()} />)

    expect(await screen.findByRole('button', { name: 'Line 2', description: 'Plant › Mixing 3 open tasks' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Assembly', description: 'No open tasks' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Choose a work center' })).toBeTruthy()
  })

  it('an engine without path or count still lists the bare names', async () => {
    vi.mocked(api.workCenters).mockResolvedValue([{ id: 'wc1', name: 'Assembly' }])
    render(<WorkCenterPicker onSelect={vi.fn()} onSignOut={vi.fn()} />)

    expect(await screen.findByRole('button', { name: 'Assembly', description: '' })).toBeTruthy()
  })

  it('fires onSelect with the clicked work center', async () => {
    vi.mocked(api.workCenters).mockResolvedValue(wcs)
    const onSelect = vi.fn()
    render(<WorkCenterPicker onSelect={onSelect} onSignOut={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Line 2' }))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(wcs[1])
  })

  it('renders a Sign Out button that fires onSignOut', async () => {
    vi.mocked(api.workCenters).mockResolvedValue(wcs)
    const onSignOut = vi.fn()
    render(<WorkCenterPicker onSelect={vi.fn()} onSignOut={onSignOut} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Sign Out' }))

    expect(onSignOut).toHaveBeenCalledTimes(1)
  })

  it('a failed load says so, Try again reloads, and Sign Out stays available', async () => {
    vi.mocked(api.workCenters).mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(wcs)
    render(<WorkCenterPicker onSelect={vi.fn()} onSignOut={vi.fn()} />)

    expect((await screen.findByRole('alert')).textContent).toBe('Could not load work centers.')
    expect(screen.getByRole('button', { name: 'Sign Out' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('button', { name: 'Assembly' })).toBeTruthy()
    expect(api.workCenters).toHaveBeenCalledTimes(2)
  })

  it('no memberships says so in words', async () => {
    vi.mocked(api.workCenters).mockResolvedValue([])
    render(<WorkCenterPicker onSelect={vi.fn()} onSignOut={vi.fn()} />)

    expect(await screen.findByText('You are not a member of any work center yet. Ask an administrator to add you.')).toBeTruthy()
  })

  it('while signing out, Sign Out is disabled and reads Signing out…', async () => {
    vi.mocked(api.workCenters).mockResolvedValue(wcs)
    render(<WorkCenterPicker onSelect={vi.fn()} onSignOut={vi.fn()} signingOut />)
    const btn = screen.getByRole('button', { name: 'Signing out…' }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    await screen.findByRole('button', { name: 'Assembly' })
  })
})
