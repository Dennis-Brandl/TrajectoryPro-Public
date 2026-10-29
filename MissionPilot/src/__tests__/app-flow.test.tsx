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
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { App } from '../App'
import { useInbox, clearSnapshotCache, type UseInboxResult } from '../inbox-data'
import { TaskScreen } from '../screens/TaskScreen'
import { api, ApiError } from '../api/client'
import type { Me, WorkCenter, InboxSnapshot, InboxTask } from '../api/types'

vi.mock('../api/client', () => {
  class ApiError extends Error {
    status: number
    constructor(status: number) {
      super(`HTTP ${status}`)
      this.name = 'ApiError'
      this.status = status
    }
  }
  return {
    api: {
      me: vi.fn(),
      signIn: vi.fn(),
      logout: vi.fn(),
      workCenters: vi.fn(),
      inbox: vi.fn(),
      claim: vi.fn(),
      release: vi.fn(),
      submit: vi.fn(),
      enterPresence: vi.fn(),
      heartbeat: vi.fn(),
      leavePresence: vi.fn(),
      // A focused task pane loads its "Where you are" steps; never resolving keeps it loading.
      runtimeDiagram: vi.fn(() => new Promise(() => {})),
      runtimeLiveStates: vi.fn(() => new Promise(() => {})),
    },
    ApiError,
  }
})

// useInbox owns SSE/poll/localStorage entirely on its own — App now calls it directly
// and threads the snapshot into the screens, so mocking it here keeps this suite about
// App's assembly/state-machine, not re-proving the data layer (already covered in
// inbox-data.test.ts). clearSnapshotCache is also stubbed here — session.tsx (Finding 2)
// calls it from signOut(), and this suite doesn't exercise cache-clearing itself
// (that's session.test.tsx's job).
// INBOX_CHANGED_EVENT is a plain constant the task pane's 'Where you are' hook listens for.
vi.mock('../inbox-data', () => ({ useInbox: vi.fn(), clearSnapshotCache: vi.fn(), INBOX_CHANGED_EVENT: 'pilot:inbox-changed' }))

// usePresence is deliberately left REAL (not mocked) — this suite is the one place that
// proves App correctly threads the selected work center's id into it, which is what
// actually calls api.enterPresence.
vi.mock('../screens/TaskScreen', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../screens/TaskScreen')>()
  return { ...actual, TaskScreen: vi.fn(actual.TaskScreen) }
})

const mockMe: Me = { id: 'u1', email: 'a@b.com', displayName: 'A B', loginName: 'ab' }
const assembly: WorkCenter = { id: 'wc1', name: 'Assembly' }

const claimedTask: InboxTask = {
  assignmentId: 'a1',
  stepInstanceId: 'si1',
  stepOid: 'so1',
  stepType: 'USER_INTERACTION',
  stepName: 'Fill form',
  instanceId: 'i1',
  runtimeNumber: 1,
  runtimeLabel: 'MIX-20261007-001',
  masterName: 'Widget',
  offeredAt: '2026-08-03T00:00:00.000Z',
  claimedAt: '2026-08-03T00:00:01.000Z',
  suggestedForMe: false,
  paused: false,
  formDocument: null,
  yesNoConfig: null,
}

function mockInbox(overrides: Partial<UseInboxResult> = {}) {
  vi.mocked(useInbox).mockReturnValue({
    snapshot: { workCenterId: 'wc1', offers: [], myClaims: [] } as InboxSnapshot,
    offline: false,
    stale: false,
    syncedAt: null,
    unreachable: false,
    refresh: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  })
}

// The shared starting point for every test that exercises the post-picker screens
// (inbox/task/header chrome): an already-signed-in user with one work center.
function mockAuthenticated() {
  vi.mocked(api.me).mockResolvedValue(mockMe)
  vi.mocked(api.workCenters).mockResolvedValue([assembly])
  vi.mocked(api.enterPresence).mockResolvedValue(undefined)
  vi.mocked(api.heartbeat).mockResolvedValue(undefined)
  vi.mocked(api.leavePresence).mockResolvedValue(undefined)
}

async function renderAtInbox() {
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'Assembly' }))
  await screen.findByText('My tasks')
}

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(cleanup)

  it('unauthenticated: shows the login screen once the session resolves with no user', async () => {
    vi.mocked(api.me).mockRejectedValue(new ApiError(401))

    render(<App />)

    expect(await screen.findByLabelText('Email')).toBeTruthy()
  })

  it('after signing in, shows the work-center picker', async () => {
    vi.mocked(api.me).mockResolvedValueOnce(null as unknown as Me).mockResolvedValueOnce(mockMe)
    vi.mocked(api.signIn).mockResolvedValue(undefined)
    vi.mocked(api.workCenters).mockResolvedValue([assembly])

    render(<App />)

    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))

    expect(await screen.findByRole('button', { name: 'Assembly' })).toBeTruthy()
  })

  it('selecting a work center enters presence and shows the inbox', async () => {
    mockAuthenticated()
    mockInbox()

    await renderAtInbox()

    expect(api.enterPresence).toHaveBeenCalledWith('wc1')
    expect(screen.getByText('My tasks')).toBeTruthy()
  })

  it('shows the selected work center name and toggles Away/Back from the operator menu', async () => {
    mockAuthenticated()
    mockInbox()

    await renderAtInbox()

    expect(screen.getByText('Assembly')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^A B/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Away' }))

    expect(await screen.findByRole('button', { name: 'Back' })).toBeTruthy()
    expect(api.heartbeat).toHaveBeenCalledWith('away')
  })

  it('switching work center from the top bar keeps the session and enters the new one', async () => {
    mockAuthenticated()
    const paint: WorkCenter = { id: 'wc2', name: 'Paint' }
    vi.mocked(api.workCenters).mockResolvedValue([assembly, paint])
    mockInbox()

    await renderAtInbox()
    fireEvent.click(screen.getByRole('button', { name: /Work center/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Paint' }))

    expect(await screen.findByText('Paint')).toBeTruthy()
    expect(api.enterPresence).toHaveBeenCalledWith('wc2')
    expect(api.leavePresence).toHaveBeenCalled()
    expect(api.logout).not.toHaveBeenCalled()
  })

  it('switching work center with open tasks goes straight there — drafts keep what was typed (P1c Ruling 2)', async () => {
    mockAuthenticated()
    const paint: WorkCenter = { id: 'wc2', name: 'Paint' }
    vi.mocked(api.workCenters).mockResolvedValue([assembly, paint])
    mockInbox({ snapshot: { workCenterId: 'wc1', offers: [], myClaims: [claimedTask] } as InboxSnapshot })

    await renderAtInbox()
    fireEvent.click(screen.getByRole('button', { name: /Work center/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Paint' }))

    expect(await screen.findByText('Paint')).toBeTruthy()
    expect(api.enterPresence).toHaveBeenCalledWith('wc2')
  })

  it('a work-center rename in Commander reaches the top bar', async () => {
    mockAuthenticated()
    mockInbox({ snapshot: { workCenterId: 'wc1', workCenterName: 'Assembly North', offers: [], myClaims: [] } as InboxSnapshot })

    await renderAtInbox()

    expect(screen.getByRole('button', { name: /Work center/ }).textContent).toContain('Assembly North')
  })

  it('opening a claimed task shows TaskScreen', async () => {
    mockAuthenticated()
    mockInbox({ snapshot: { workCenterId: 'wc1', myClaims: [claimedTask], offers: [] } })

    await renderAtInbox()
    fireEvent.click(screen.getByRole('button', { name: /Fill form/ }))

    expect(await screen.findByRole('button', { name: 'Continue' })).toBeTruthy()
  })

  it('completing a task returns to the inbox', async () => {
    mockAuthenticated()
    mockInbox({ snapshot: { workCenterId: 'wc1', myClaims: [claimedTask], offers: [] } })
    vi.mocked(api.submit).mockResolvedValue(undefined)

    await renderAtInbox()
    fireEvent.click(screen.getByRole('button', { name: /Fill form/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))

    expect(await screen.findByRole('heading', { name: 'My tasks' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
  })

  it('a submit that loses the race (409) toasts and returns to the inbox', async () => {
    mockAuthenticated()
    mockInbox({ snapshot: { workCenterId: 'wc1', myClaims: [claimedTask], offers: [] } })
    vi.mocked(api.submit).mockRejectedValue(new ApiError(409))

    await renderAtInbox()
    fireEvent.click(screen.getByRole('button', { name: /Fill form/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))

    expect(await screen.findByText('This task changed — refreshing.')).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'My tasks' })).toBeTruthy()
  })

  it('a transient submit error toasts and leaves the operator on the task screen', async () => {
    mockAuthenticated()
    mockInbox({ snapshot: { workCenterId: 'wc1', myClaims: [claimedTask], offers: [] } })
    vi.mocked(api.submit).mockRejectedValue(new TypeError('Failed to fetch'))

    await renderAtInbox()
    fireEvent.click(screen.getByRole('button', { name: /Fill form/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))

    expect(await screen.findByText('Something went wrong — try again.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'My tasks' })).toBeNull()
  })

  it('signing out calls logout and returns to the login screen', async () => {
    mockAuthenticated()
    mockInbox()
    vi.mocked(api.logout).mockResolvedValue(undefined)

    await renderAtInbox()
    fireEvent.click(screen.getByRole('button', { name: /^A B/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }))

    expect(await screen.findByLabelText('Email')).toBeTruthy()
    expect(api.logout).toHaveBeenCalledTimes(1)
  })

  it('signOut-engine-down returns to the login screen', async () => {
    mockAuthenticated()
    mockInbox()
    vi.mocked(api.logout).mockRejectedValue(new TypeError('Failed to fetch'))
    sessionStorage.setItem('pilot:draft:a1', JSON.stringify({ stepInstanceId: 'si1', values: { x: '1' } }))

    await renderAtInbox()
    fireEvent.click(screen.getByRole('button', { name: /^A B/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }))

    expect(await screen.findByLabelText('Email')).toBeTruthy()
    expect(clearSnapshotCache).toHaveBeenCalled()
    expect(sessionStorage.getItem('pilot:draft:a1')).toBeNull()

    // sign in again: the earlier draft is gone
    vi.mocked(api.signIn).mockResolvedValue(undefined)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))
    expect(await screen.findByRole('button', { name: 'Assembly' })).toBeTruthy()
    expect(sessionStorage.getItem('pilot:draft:a1')).toBeNull()
  })

  it('signing out from the work-center picker returns to the login screen', async () => {
    mockAuthenticated()
    mockInbox()
    vi.mocked(api.logout).mockResolvedValue(undefined)

    render(<App />)
    await screen.findByRole('button', { name: 'Assembly' }) // at the picker, no WC entered
    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }))

    expect(await screen.findByLabelText('Email')).toBeTruthy()
    expect(api.logout).toHaveBeenCalledTimes(1)
  })

  it('going offline shows the offline banner', async () => {
    mockAuthenticated()
    mockInbox()

    await renderAtInbox()

    act(() => {
      window.dispatchEvent(new Event('offline'))
    })

    expect(await screen.findByText('Offline — showing the last known inbox. Actions are disabled.')).toBeTruthy()
  })

  it('shows a role=alert with the fixed copy when presence fails to enter the work center', async () => {
    mockAuthenticated()
    vi.mocked(api.enterPresence).mockRejectedValue(new Error('boom'))
    mockInbox()

    await renderAtInbox()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Could not enter work center.')
  })

  it('a TaskScreen render error is caught by its own pane boundary; other panes still work and Back to inbox recovers', async () => {
    const secondTask: InboxTask = {
      ...claimedTask,
      assignmentId: 'a2',
      stepInstanceId: 'si2',
      stepName: 'Second step',
      claimedAt: '2026-08-03T00:00:02.000Z',
    }
    mockAuthenticated()
    mockInbox({ snapshot: { workCenterId: 'wc1', myClaims: [claimedTask, secondTask], offers: [] } })
    // Throw persistently for ONE pane only (React 19 retries a failing render
    // synchronously before the boundary takes hold — a once-mock gets consumed by
    // the discarded first attempt); the sibling pane must render normally.
    const realTaskScreen = vi.mocked(TaskScreen).getMockImplementation()
    vi.mocked(TaskScreen).mockImplementation((props) => {
      if (props.task.assignmentId === 'a1') throw new Error('boom')
      return realTaskScreen!(props)
    })

    await renderAtInbox()
    fireEvent.click(screen.getByRole('button', { name: /Fill form/ }))

    expect(await screen.findByText('Something went wrong showing this task.')).toBeTruthy()

    // The crash is contained to its pane: the second claim's tab still opens fine.
    fireEvent.click(screen.getByRole('tab', { name: /Second step/ }))
    expect(await screen.findByRole('button', { name: 'Continue' })).toBeTruthy()

    vi.mocked(TaskScreen).mockImplementation(realTaskScreen!)
    fireEvent.click(screen.getByRole('tab', { name: /Fill form/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Back to inbox' }))

    expect(await screen.findByRole('heading', { name: 'My tasks' })).toBeTruthy()
  })
})
