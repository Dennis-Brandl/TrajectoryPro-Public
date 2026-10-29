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
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { WorkCenterSwitcher } from '../WorkCenterSwitcher'
import { api } from '../../api/client'
import type { WorkCenter } from '../../api/types'

vi.mock('../../api/client', () => ({ api: { workCenters: vi.fn() } }))

const A: WorkCenter = { id: 'wc1', name: 'Assembly' }
const P: WorkCenter = { id: 'wc2', name: 'Paint' }

function renderSwitcher() {
  const onSwitch = vi.fn()
  render(<WorkCenterSwitcher current={A} onSwitch={onSwitch} />)
  fireEvent.click(screen.getByRole('button', { name: /Work center/ }))
  return onSwitch
}

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('WorkCenterSwitcher (spec §5.1)', () => {
  it('lists the work centers with the current one marked; with no open tasks, picking one switches at once', async () => {
    vi.mocked(api.workCenters).mockResolvedValue([A, P])
    const onSwitch = renderSwitcher()
    expect((await screen.findByRole('button', { name: 'Assembly' })).getAttribute('aria-current')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Paint' }))
    expect(onSwitch).toHaveBeenCalledWith(P)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('picking the current work center just closes', async () => {
    vi.mocked(api.workCenters).mockResolvedValue([A, P])
    const onSwitch = renderSwitcher()
    fireEvent.click(await screen.findByRole('button', { name: 'Assembly' }))
    expect(onSwitch).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a failed load says so, and Close still closes', async () => {
    vi.mocked(api.workCenters).mockRejectedValue(new Error('offline'))
    renderSwitcher()
    expect((await screen.findByRole('alert')).textContent).toBe('Could not load work centers.')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
