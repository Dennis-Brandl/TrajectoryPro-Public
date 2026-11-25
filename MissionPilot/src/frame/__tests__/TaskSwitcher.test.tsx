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

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InboxTask } from '../../api/types'
import { TaskSwitcher } from '../TaskSwitcher'

afterEach(cleanup)

function task(overrides: Partial<InboxTask> = {}): InboxTask {
  return {
    assignmentId: 'a1',
    stepInstanceId: 'si1',
    stepOid: 'so1',
    stepType: 'USER_INTERACTION',
    stepName: 'Step',
    instanceId: 'i1',
    runtimeNumber: 1,
    runtimeLabel: 'MIX-20261007-001',
    masterName: 'Master',
    offeredAt: '2026-08-03T00:00:00.000Z',
    claimedAt: '2026-08-03T00:00:01.000Z',
    suggestedForMe: false,
    paused: false,
    formDocument: null,
    yesNoConfig: null,
    ...overrides,
  }
}

const three = [
  task({ assignmentId: 'a-1', stepName: 'Fit bracket' }),
  task({ assignmentId: 'a-2', stepName: 'Torque check' }),
  task({ assignmentId: 'a-3', stepName: 'Final seal' }),
]

describe('TaskSwitcher', () => {
  it('renders nothing for a single task', () => {
    const { container } = render(<TaskSwitcher tasks={three.slice(0, 1)} focusedId="a-1" onPick={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when the focused task is not in the list', () => {
    const { container } = render(<TaskSwitcher tasks={three} focusedId="zzz" onPick={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows the step and position', () => {
    render(<TaskSwitcher tasks={three} focusedId="a-2" onPick={() => {}} />)
    const mid = screen.getByRole('button', { name: 'Open tasks: Torque check, 2 of 3' })
    expect(mid.textContent).toBe('Torque check · 2 of 3')
    expect(mid.getAttribute('aria-haspopup')).toBe('dialog')
  })

  it('Previous picks the first task', () => {
    const onPick = vi.fn()
    render(<TaskSwitcher tasks={three} focusedId="a-2" onPick={onPick} />)
    fireEvent.click(screen.getByRole('button', { name: 'Previous task' }))
    expect(onPick).toHaveBeenCalledWith('a-1')
  })

  it('wraps: Previous on the first task picks the last, Next on the last picks the first (user 2026-11-25)', () => {
    const onPick = vi.fn()
    const { unmount } = render(<TaskSwitcher tasks={three} focusedId="a-1" onPick={onPick} />)
    const prev = screen.getByRole('button', { name: 'Previous task' }) as HTMLButtonElement
    expect(prev.disabled).toBe(false)
    fireEvent.click(prev)
    expect(onPick).toHaveBeenLastCalledWith('a-3')
    unmount()
    render(<TaskSwitcher tasks={three} focusedId="a-3" onPick={onPick} />)
    const next = screen.getByRole('button', { name: 'Next task' }) as HTMLButtonElement
    expect(next.disabled).toBe(false)
    fireEvent.click(next)
    expect(onPick).toHaveBeenLastCalledWith('a-1')
  })

  it('opens the sheet; picking calls onPick and closes it', () => {
    const onPick = vi.fn()
    render(<TaskSwitcher tasks={three} focusedId="a-2" onPick={onPick} />)
    expect(screen.queryByRole('dialog', { name: 'Open tasks' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Open tasks:/ }))
    expect(screen.getByRole('dialog', { name: 'Open tasks' })).toBeTruthy()
    fireEvent.click(screen.getByText('Final seal'))
    expect(onPick).toHaveBeenCalledWith('a-3')
    expect(screen.queryByRole('dialog', { name: 'Open tasks' })).toBeNull()
  })
})
