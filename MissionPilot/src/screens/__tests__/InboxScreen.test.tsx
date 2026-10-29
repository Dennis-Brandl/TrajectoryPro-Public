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
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { InboxScreen, type InboxScreenProps } from '../InboxScreen'
import { api, ApiError } from '../../api/client'
import { Toasts } from '../../toast'
import type { InboxTask } from '../../api/types'

// InboxScreen is presentational since the useInbox lift — tests hand it a snapshot
// directly. Toasts is still mounted alongside, as App would.
function renderInbox(overrides: Partial<InboxScreenProps> = {}) {
  const props: InboxScreenProps = {
    snapshot: { workCenterId: 'wc1', offers: [], myClaims: [] },
    offline: false,
    refresh: vi.fn().mockResolvedValue(undefined),
    onOpenTask: vi.fn(),
    onReleased: vi.fn(),
    ...overrides,
  }
  render(
    <>
      <Toasts />
      <InboxScreen {...props} />
    </>,
  )
  return props
}

vi.mock('../../api/client', () => {
  class ApiError extends Error {
    status: number
    constructor(status: number) {
      super(`HTTP ${status}`)
      this.status = status
    }
  }
  return {
    api: { claim: vi.fn(), release: vi.fn() },
    ApiError,
  }
})

function task(overrides: Partial<InboxTask> = {}): InboxTask {
  return {
    assignmentId: 'a1',
    stepInstanceId: 'si1',
    stepOid: 'so1',
    stepType: 'form',
    stepName: 'Step',
    instanceId: 'i1',
    runtimeNumber: 1,
    runtimeLabel: 'MIX-20261007-001',
    masterName: 'Master',
    offeredAt: '2026-08-03T00:00:00.000Z',
    claimedAt: null,
    suggestedForMe: false,
    paused: false,
    formDocument: null,
    yesNoConfig: null,
    ...overrides,
  }
}

describe('InboxScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(cleanup)

  it('renders My tasks above Available, preserving server order, with the right badges', () => {
    const claimA = task({ assignmentId: 'c1', stepName: 'Claim A', paused: true })
    const claimB = task({ assignmentId: 'c2', stepName: 'Claim B', paused: false })
    const offerA = task({ assignmentId: 'o1', stepName: 'Offer A', suggestedForMe: true })
    const offerB = task({ assignmentId: 'o2', stepName: 'Offer B', suggestedForMe: false })
    renderInbox({
      snapshot: { workCenterId: 'wc1', myClaims: [claimA, claimB], offers: [offerA, offerB] },
    })

    const headings = screen.getAllByRole('heading').map((h) => h.textContent)
    expect(headings).toEqual(['My tasks', 'Available'])

    const items = screen.getAllByRole('listitem')
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining('Claim A'),
      expect.stringContaining('Claim B'),
      expect.stringContaining('Offer A'),
      expect.stringContaining('Offer B'),
    ])

    expect(within(items[0]!).getByText('Paused')).toBeTruthy()
    expect(within(items[1]!).queryByText('Paused')).toBeNull()
    expect(within(items[2]!).getByText('Suggested for you')).toBeTruthy()
    expect(within(items[3]!).queryByText('Suggested for you')).toBeNull()
    expect(Array.from(document.querySelectorAll('.inbox-count')).map((c) => c.textContent)).toEqual(['2', '2'])
  })

  it('shows stepName (or stepOid fallback), masterName, and the configured runtimeLabel in the row metadata', () => {
    const offer = task({
      stepName: null, stepOid: 'step-42', masterName: 'Widget Assembly',
      runtimeNumber: 7, runtimeLabel: 'MIX-20261007-007',
    })

    renderInbox({ snapshot: { workCenterId: 'wc1', myClaims: [], offers: [offer] } })

    const row = screen.getByRole('listitem')
    expect(row.textContent).toContain('step-42')
    expect(row.textContent).toContain('Widget Assembly')
    expect(row.textContent).toContain('MIX-20261007-007')
    expect(row.textContent).not.toContain('RW-7')
  })

  it('claim success refreshes the snapshot, then opens the task', async () => {
    const offer = task({ assignmentId: 'o1', stepName: 'Offer A' })
    const calls: string[] = []
    const refresh = vi.fn(async () => {
      await Promise.resolve()
      calls.push('refresh')
    })
    const onOpenTask = vi.fn(() => {
      calls.push('open')
    })
    renderInbox({ snapshot: { workCenterId: 'wc1', myClaims: [], offers: [offer] }, refresh, onOpenTask })

    fireEvent.click(screen.getByRole('button', { name: 'Claim' }))

    await waitFor(() => expect(onOpenTask).toHaveBeenCalledWith(offer))
    expect(api.claim).toHaveBeenCalledWith('o1')
    expect(calls).toEqual(['refresh', 'open'])
  })

  it('claim success still opens the task when the refresh itself fails', async () => {
    const offer = task({ assignmentId: 'o1', stepName: 'Offer A' })
    const refresh = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const onOpenTask = vi.fn()
    renderInbox({ snapshot: { workCenterId: 'wc1', myClaims: [], offers: [offer] }, refresh, onOpenTask })

    fireEvent.click(screen.getByRole('button', { name: 'Claim' }))

    await waitFor(() => expect(onOpenTask).toHaveBeenCalledWith(offer))
  })

  it('two Claim taps make one claim and show no error', async () => {
    const offer = task({ assignmentId: 'o1', stepName: 'Offer A' })
    let resolveClaim!: () => void
    vi.mocked(api.claim).mockReturnValue(new Promise<void>((r) => { resolveClaim = r }) as never)
    const onOpenTask = vi.fn()
    renderInbox({ snapshot: { workCenterId: 'wc1', myClaims: [], offers: [offer] }, onOpenTask })

    const button = screen.getByRole('button', { name: 'Claim' })
    fireEvent.click(button)
    fireEvent.click(button)
    resolveClaim()

    await waitFor(() => expect(onOpenTask).toHaveBeenCalledTimes(1))
    expect(api.claim).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Task no longer available')).toBeNull()
  })

  it('claim re-enables after a failed claim', async () => {
    const offer = task({ assignmentId: 'o1', stepName: 'Offer A' })
    vi.mocked(api.claim).mockRejectedValueOnce(new ApiError(500)).mockResolvedValue(undefined as never)
    renderInbox({ snapshot: { workCenterId: 'wc1', myClaims: [], offers: [offer] } })

    fireEvent.click(screen.getByRole('button', { name: 'Claim' }))
    expect(await screen.findByText('Something went wrong — try again.')).toBeTruthy()
    await waitFor(() => expect((screen.getByRole('button', { name: 'Claim' }) as HTMLButtonElement).disabled).toBe(false))

    fireEvent.click(screen.getByRole('button', { name: 'Claim' }))
    await waitFor(() => expect(api.claim).toHaveBeenCalledTimes(2))
  })

  it('claim 409 shows the fixed toast and refreshes, without navigating', async () => {
    const offer = task({ assignmentId: 'o1', stepName: 'Offer A' })
    const refresh = vi.fn().mockResolvedValue(undefined)
    vi.mocked(api.claim).mockRejectedValue(new ApiError(409))
    const onOpenTask = vi.fn()

    renderInbox({ snapshot: { workCenterId: 'wc1', myClaims: [], offers: [offer] }, refresh, onOpenTask })
    fireEvent.click(screen.getByRole('button', { name: 'Claim' }))

    expect(await screen.findByText('Task no longer available')).toBeTruthy()
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(onOpenTask).not.toHaveBeenCalled()
  })

  it('claim 403 (lost the race) also shows the fixed toast and refreshes', async () => {
    const offer = task({ assignmentId: 'o1', stepName: 'Offer A' })
    const refresh = vi.fn().mockResolvedValue(undefined)
    vi.mocked(api.claim).mockRejectedValue(new ApiError(403))

    renderInbox({ snapshot: { workCenterId: 'wc1', myClaims: [], offers: [offer] }, refresh })
    fireEvent.click(screen.getByRole('button', { name: 'Claim' }))

    expect(await screen.findByText('Task no longer available')).toBeTruthy()
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  })

  it('release calls api.release then refresh, and reports the release for the pane to retire', async () => {
    const claim = task({ assignmentId: 'c1', stepName: 'Claim A' })
    const refresh = vi.fn().mockResolvedValue(undefined)
    const onReleased = vi.fn()
    vi.mocked(api.release).mockResolvedValue(undefined)

    renderInbox({ snapshot: { workCenterId: 'wc1', myClaims: [claim], offers: [] }, refresh, onReleased })
    fireEvent.click(screen.getByRole('button', { name: 'Release' }))

    await waitFor(() => expect(api.release).toHaveBeenCalledWith('c1'))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(onReleased).toHaveBeenCalledWith(claim)
  })

  it('release failure shows the fixed toast, still refreshes, and does not report a release', async () => {
    const claim = task({ assignmentId: 'c1', stepName: 'Claim A' })
    const refresh = vi.fn().mockResolvedValue(undefined)
    const onReleased = vi.fn()
    vi.mocked(api.release).mockRejectedValue(new ApiError(403))

    renderInbox({ snapshot: { workCenterId: 'wc1', myClaims: [claim], offers: [] }, refresh, onReleased })
    fireEvent.click(screen.getByRole('button', { name: 'Release' }))

    expect(await screen.findByText('Could not release')).toBeTruthy()
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(onReleased).not.toHaveBeenCalled()
  })

  it('claim failing with a non-race ApiError (500) shows the generic copy, refreshes, and does not navigate', async () => {
    const offer = task({ assignmentId: 'o1', stepName: 'Offer A' })
    const refresh = vi.fn().mockResolvedValue(undefined)
    vi.mocked(api.claim).mockRejectedValue(new ApiError(500))
    const onOpenTask = vi.fn()

    renderInbox({ snapshot: { workCenterId: 'wc1', myClaims: [], offers: [offer] }, refresh, onOpenTask })
    fireEvent.click(screen.getByRole('button', { name: 'Claim' }))

    expect(await screen.findByText('Something went wrong — try again.')).toBeTruthy()
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(onOpenTask).not.toHaveBeenCalled()
  })

  it('claim failing with a plain (network) error shows the generic copy and refreshes', async () => {
    const offer = task({ assignmentId: 'o1', stepName: 'Offer A' })
    const refresh = vi.fn().mockResolvedValue(undefined)
    vi.mocked(api.claim).mockRejectedValue(new TypeError('Failed to fetch'))

    renderInbox({ snapshot: { workCenterId: 'wc1', myClaims: [], offers: [offer] }, refresh })
    fireEvent.click(screen.getByRole('button', { name: 'Claim' }))

    expect(await screen.findByText('Something went wrong — try again.')).toBeTruthy()
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  })

  it('release failing with a non-race error shows the generic copy and still refreshes', async () => {
    const claim = task({ assignmentId: 'c1', stepName: 'Claim A' })
    const refresh = vi.fn().mockResolvedValue(undefined)
    vi.mocked(api.release).mockRejectedValue(new TypeError('Failed to fetch'))

    renderInbox({ snapshot: { workCenterId: 'wc1', myClaims: [claim], offers: [] }, refresh })
    fireEvent.click(screen.getByRole('button', { name: 'Release' }))

    expect(await screen.findByText('Something went wrong — try again.')).toBeTruthy()
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  })

  it('a paused claim row exposes no reopen button, only plain text', () => {
    const claim = task({ assignmentId: 'c1', stepName: 'Claim A', paused: true })

    renderInbox({ snapshot: { workCenterId: 'wc1', myClaims: [claim], offers: [] } })

    expect(screen.queryByRole('button', { name: /Claim A/ })).toBeNull()
    expect(screen.getByText('Claim A')).toBeTruthy()
  })

  it('reopens a non-paused claim via its row button, without calling the API', () => {
    const claim = task({ assignmentId: 'c1', stepName: 'Claim A', paused: false })
    const onOpenTask = vi.fn()

    renderInbox({ snapshot: { workCenterId: 'wc1', myClaims: [claim], offers: [] }, onOpenTask })
    fireEvent.click(screen.getByRole('button', { name: /Claim A/ }))

    expect(onOpenTask).toHaveBeenCalledWith(claim)
    expect(api.claim).not.toHaveBeenCalled()
  })

  it('while offline, Claim and Release buttons are disabled', () => {
    const claim = task({ assignmentId: 'c1', stepName: 'Claim A' })
    const offer = task({ assignmentId: 'o1', stepName: 'Offer A' })

    renderInbox({ snapshot: { workCenterId: 'wc1', myClaims: [claim], offers: [offer] }, offline: true })

    expect((screen.getByRole('button', { name: 'Claim' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Release' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('Release asks first when the claim has typed values saved, and clears them once released', async () => {
    const claim = task({ assignmentId: 'c1', stepName: 'Claim A' })
    vi.mocked(api.release).mockResolvedValue(undefined)
    sessionStorage.setItem('pilot:draft:c1', JSON.stringify({ stepInstanceId: 'si1', values: { lot: 'L-7', qty: '3' } }))

    renderInbox({ snapshot: { workCenterId: 'wc1', myClaims: [claim], offers: [] } })
    fireEvent.click(screen.getByRole('button', { name: 'Release' }))
    expect(screen.getByRole('alert').textContent).toBe('Release and discard 2 entered values?')
    expect(api.release).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Release' }))

    await waitFor(() => expect(api.release).toHaveBeenCalledWith('c1'))
    await waitFor(() => expect(sessionStorage.getItem('pilot:draft:c1')).toBeNull())
  })

  it('each row shows step, workflow with version and child path, runtime ID, and how long it has waited', () => {
    vi.useFakeTimers({ now: Date.parse('2026-10-10T12:00:00.000Z'), toFake: ['Date'] })
    try {
      const offer = task({
        stepName: 'Charge Kettle', masterName: 'Batch Mix', masterVersion: '3', workflowPath: ['Charge sub-flow'],
        runtimeLabel: 'MIX-20261009-0002', stepUpdatedAt: '2026-10-10T11:55:00.000Z',
      })
      renderInbox({ snapshot: { workCenterId: 'wc1', myClaims: [], offers: [offer] } })
      const row = screen.getByRole('listitem')
      expect(row.querySelector('.inbox-workflow')!.textContent).toBe('Batch Mix v3 › Charge sub-flow')
      expect(row.querySelector('.inbox-runtime')!.textContent).toBe('MIX-20261009-0002')
      expect(row.querySelector('.inbox-age time')!.textContent).toBe('5 min')
      expect(row.querySelector('.inbox-age time')!.getAttribute('datetime')).toBe('2026-10-10T11:55:00.000Z')
    } finally {
      vi.useRealTimers()
    }
  })

  it('an empty section says so in words', () => {
    renderInbox({ snapshot: { workCenterId: 'wc1', myClaims: [], offers: [] } })
    expect(screen.getByText('You have no claimed tasks. Claim one from Available.')).toBeTruthy()
    expect(screen.getByText('Nothing is waiting for an operator right now.')).toBeTruthy()
    expect(Array.from(document.querySelectorAll('.inbox-count')).map((c) => c.textContent)).toEqual(['0', '0'])
  })

  it('the filter matches step, workflow or runtime ID and the counts say how many of the total show', () => {
    const a = task({ assignmentId: 'o1', stepName: 'Charge Kettle', runtimeLabel: 'MIX-20261009-0001' })
    const b = task({ assignmentId: 'o2', stepName: 'Charge Kettle', runtimeLabel: 'MIX-20261009-0002' })
    const c = task({ assignmentId: 'o3', stepName: 'Weigh', masterName: 'Packing' })
    renderInbox({ snapshot: { workCenterId: 'wc1', myClaims: [], offers: [a, b, c] } })

    const filter = screen.getByRole('searchbox', { name: 'Filter by step, workflow or runtime ID' })
    expect(filter.getAttribute('placeholder')).toBe('Filter by step, workflow or runtime ID')
    fireEvent.change(filter, { target: { value: '0002' } })
    expect(screen.getAllByRole('listitem').map((li) => li.querySelector('.inbox-runtime')!.textContent)).toEqual(['MIX-20261009-0002'])
    expect(document.querySelectorAll('.inbox-count')[1]!.textContent).toBe('1 of 3')

    fireEvent.change(filter, { target: { value: 'packing' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  it('a filter that matches nothing says so, and clearing it brings every row back', () => {
    renderInbox({ snapshot: { workCenterId: 'wc1', myClaims: [task({ assignmentId: 'c1' })], offers: [task({ assignmentId: 'o1' })] } })
    const filter = screen.getByRole('searchbox', { name: 'Filter by step, workflow or runtime ID' })
    fireEvent.change(filter, { target: { value: 'nothing like it' } })
    expect(screen.getAllByText('No tasks match “nothing like it”.')).toHaveLength(2)
    fireEvent.change(filter, { target: { value: '' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('a task arriving while filtering stays hidden, but the count shows it exists (Review Focus 2)', () => {
    const props: InboxScreenProps = {
      snapshot: { workCenterId: 'wc1', myClaims: [], offers: [task({ assignmentId: 'o1', stepName: 'Charge Kettle' })] },
      offline: false, refresh: vi.fn().mockResolvedValue(undefined), onOpenTask: vi.fn(), onReleased: vi.fn(),
    }
    const { rerender } = render(<InboxScreen {...props} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'kettle' } })

    rerender(
      <InboxScreen
        {...props}
        snapshot={{
          workCenterId: 'wc1', myClaims: [],
          offers: [task({ assignmentId: 'o1', stepName: 'Charge Kettle' }), task({ assignmentId: 'o2', stepName: 'Weigh' })],
        }}
      />,
    )
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(document.querySelectorAll('.inbox-count')[1]!.textContent).toBe('1 of 2')
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('kettle')
  })
})
