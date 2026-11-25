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
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { TaskAppBar, type TaskAppBarProps } from '../TaskAppBar'
import type { InboxTask } from '../../api/types'

afterEach(cleanup)

function task(over: Partial<InboxTask> = {}): InboxTask {
  return {
    assignmentId: 'a1',
    stepInstanceId: 'si1',
    stepOid: 'so1',
    stepType: 'USER_INTERACTION',
    stepName: 'Charge Kettle',
    instanceId: 'i1',
    runtimeNumber: 2,
    runtimeLabel: 'MIX-20261009-0002',
    masterName: 'Batch Mix',
    offeredAt: '2026-10-09T00:00:00.000Z',
    claimedAt: '2026-10-09T00:00:01.000Z',
    suggestedForMe: false,
    paused: false,
    formDocument: null,
    yesNoConfig: null,
    ...over,
  }
}

function bar(over: Partial<TaskAppBarProps> = {}) {
  const props: TaskAppBarProps = {
    task: task(),
    back: null,
    onHome: () => {},
    connection: { online: true, stale: false, unreachable: false, syncedAt: new Date(2026, 9, 9, 10, 42) },
    menu: [],
    ...over,
  }
  return render(<TaskAppBar {...props} />)
}

describe('TaskAppBar', () => {
  it('has no Back button when back is null', () => {
    bar()
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  })

  it('Back calls onBack and is disabled when asked', () => {
    const onBack = vi.fn()
    bar({ back: { onBack, disabled: false } })
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalledTimes(1)
    cleanup()
    bar({ back: { onBack, disabled: true } })
    expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('Home calls onHome', () => {
    const onHome = vi.fn()
    bar({ onHome })
    fireEvent.click(screen.getByRole('button', { name: 'Inbox' }))
    expect(onHome).toHaveBeenCalledTimes(1)
  })

  it('line 1 shows the runtime label and workflow; a sub-workflow path uses ›', () => {
    const { container } = bar({ task: task({ masterVersion: '3', workflowPath: ['Charge sub-flow', 'Inner'] }) })
    const line1 = container.querySelector('.task-app-line1')!
    expect(line1.textContent).toContain('MIX-20261009-0002')
    expect(line1.textContent).toContain('Batch Mix v3 › Charge sub-flow › Inner')
  })

  it('line 1 shows the master name when there is no path', () => {
    const { container } = bar()
    expect(container.querySelector('.task-app-line1')!.textContent).toContain('Batch Mix')
  })

  it('line 2 is the step name, falling back to the step OID', () => {
    const { container } = bar()
    expect(container.querySelector('.task-app-line2')!.textContent).toBe('Charge Kettle')
    cleanup()
    const again = bar({ task: task({ stepName: null }) })
    expect(again.container.querySelector('.task-app-line2')!.textContent).toBe('so1')
  })

  it('shows no connection status when healthy, and one when offline', () => {
    const { container } = bar()
    expect(container.querySelector('.conn')).toBeNull()
    cleanup()
    const off = bar({ connection: { online: false, stale: false, unreachable: false, syncedAt: null } })
    expect(off.container.textContent).toContain('Offline')
  })

  it('⋮ lists the given items', () => {
    bar({ menu: [{ label: 'Release', onSelect: () => {} }, { label: 'Copy runtime ID', onSelect: () => {} }] })
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(screen.getByRole('menuitem', { name: 'Release' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Copy runtime ID' })).toBeTruthy()
  })
})
